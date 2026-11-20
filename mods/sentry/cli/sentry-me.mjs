#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

const BASE = "https://mcp.sentry.dev";
const PROTOCOL = "2025-06-18";
const STORE = path.join(os.homedir(), ".config/herdr-sentry/mcp.json");
const LOGIN_TIMEOUT = 5 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
}

export function parseRpc(text, contentType = "") {
  if (!String(contentType).includes("text/event-stream")) return text.trim() ? JSON.parse(text) : null;
  const messages = text.split(/\r?\n\r?\n/)
    .map((event) => event.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n"))
    .filter(Boolean).map((data) => JSON.parse(data));
  return messages.find((m) => m.id !== undefined) ?? messages.at(-1) ?? null;
}

export function resultValue(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  try { return JSON.parse(text); } catch { return text; }
}

async function load() {
  try { return JSON.parse(await fs.readFile(STORE, "utf8")); } catch { return null; }
}

async function save(data) {
  await fs.mkdir(path.dirname(STORE), { recursive: true, mode: 0o700 });
  await fs.writeFile(`${STORE}.tmp`, JSON.stringify(data), { mode: 0o600 });
  await fs.rename(`${STORE}.tmp`, STORE);
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function postForm(url, fields) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function endpoints() {
  const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
  if (!res.ok) throw new Error(`Sentry's OAuth metadata: HTTP ${res.status}`);
  const m = await res.json();
  return { register: m.registration_endpoint, authorize: m.authorization_endpoint, token: m.token_endpoint };
}

const tokens = (t, prev = {}) => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token ?? prev.refresh_token,
  expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000,
});

async function login() {
  const ep = await endpoints();
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  try {
    const reg = await postJson(ep.register, {
      client_name: "Herdr Sentry mod", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none",
    });
    const { verifier, challenge } = pkce();
    const state = b64url(crypto.randomBytes(16));
    const url = `${ep.authorize}?${new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect,
      code_challenge: challenge, code_challenge_method: "S256", state })}`;
    const code = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no answer from the browser in 5 minutes")), LOGIN_TIMEOUT);
      server.on("request", (req, res) => {
        const u = new URL(req.url, redirect);
        if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
        clearTimeout(timer);
        if (u.searchParams.get("state") !== state || !u.searchParams.get("code")) {
          res.writeHead(400).end("Sentry sign-in failed, go back to Herdr.");
          reject(new Error(u.searchParams.get("error_description") ?? u.searchParams.get("error") ?? "bad answer from Sentry"));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Sentry is connected. You can close this tab.");
        resolve(u.searchParams.get("code"));
      });
    });
    console.log(`Opening Sentry in your browser. If it doesn't open, visit:\n${url}`);
    execFile("open", [url], () => {});
    const t = await postForm(ep.token, { grant_type: "authorization_code", code: await code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier });
    await save({ client_id: reg.client_id, token_endpoint: ep.token, ...tokens(t) });
    console.log("Connected.");
  } finally {
    server.close();
  }
}

async function accessToken() {
  const t = await load();
  if (!t?.access_token) throw new Error("not connected: run sentry-me login");
  if (t.expires_at - 60000 > Date.now()) return t.access_token;
  if (!t.refresh_token) throw new Error("session expired: run sentry-me login");
  const url = t.token_endpoint ?? (await endpoints()).token;
  const fresh = { ...t, ...tokens(await postForm(url, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id }), t) };
  await save(fresh);
  return fresh.access_token;
}

async function rpc(token, session, message) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL, ...(session ? { "Mcp-Session-Id": session } : {}) },
    body: JSON.stringify(message),
  });
  if (res.status === 401) throw new Error("Sentry refused the session: run sentry-me login");
  if (!res.ok && res.status !== 202) throw new Error(`MCP: HTTP ${res.status} ${await res.text()}`);
  return { session: res.headers.get("mcp-session-id") ?? session, message: parseRpc(await res.text(), res.headers.get("content-type") ?? "") };
}

export async function mcp(method, params) {
  const token = await accessToken();
  const init = await rpc(token, null, { jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "herdr-sentry", version: "1" } } });
  if (init.message?.error) throw new Error(init.message.error.message);
  await rpc(token, init.session, { jsonrpc: "2.0", method: "notifications/initialized" });
  const r = await rpc(token, init.session, { jsonrpc: "2.0", id: 2, method, params });
  if (r.message?.error) throw new Error(r.message.error.message);
  return r.message?.result;
}

async function readStdin(stream) {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

export async function readArgs(arg, stdin = process.stdin) {
  if (!arg) return {};
  if (arg === "-") return JSON.parse(await readStdin(stdin));
  if (arg.startsWith("@")) return JSON.parse(await fs.readFile(arg.slice(1), "utf8"));
  return JSON.parse(arg);
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "login") return login();
  if (command === "logout") { await fs.rm(STORE, { force: true }); console.log("Disconnected."); return; }
  if (command === "status") { const t = await load(); console.log(JSON.stringify({ connected: Boolean(t?.access_token) })); return; }
  if (command === "tools") {
    const r = await mcp("tools/list", {});
    console.log(JSON.stringify((r?.tools ?? []).map((x) => ({ name: x.name, description: x.description, input: x.inputSchema })), null, 2));
    return;
  }
  if (command === "call" && rest[0]) {
    const result = await mcp("tools/call", { name: rest[0], arguments: await readArgs(rest[1]) });
    if (result?.isError) throw new Error(String(resultValue(result)));
    console.log(JSON.stringify({ ok: true, value: resultValue(result) }));
    return;
  }
  console.error("usage: sentry-me login | logout | status | tools | call <tool> [json | - (stdin) | @file]");
  process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e) })); process.exitCode = 1; });
}
