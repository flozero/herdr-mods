#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const BASE = "https://mcp.linear.app";
const PROTOCOL = "2025-06-18";
const STORE = path.join(os.homedir(), ".config/herdr-linear/mcp.json");
const LOGIN_TIMEOUT = 5 * 60 * 1000;
const WATCHER = "linear-watch";
const ISSUE_ID = /^[A-Z][A-Z0-9]*-\d+$/;

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

const tokens = (t, prev = {}) => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token ?? prev.refresh_token,
  expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000,
});

async function login() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  try {
    const reg = await postJson(`${BASE}/register`, {
      client_name: "Herdr Linear mod", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none",
    });
    const { verifier, challenge } = pkce();
    const state = b64url(crypto.randomBytes(16));
    const url = `${BASE}/authorize?${new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect,
      code_challenge: challenge, code_challenge_method: "S256", state })}`;
    const code = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no answer from the browser in 5 minutes")), LOGIN_TIMEOUT);
      server.on("request", (req, res) => {
        const u = new URL(req.url, redirect);
        if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
        clearTimeout(timer);
        if (u.searchParams.get("state") !== state || !u.searchParams.get("code")) {
          res.writeHead(400).end("Linear sign-in failed, go back to Herdr.");
          reject(new Error(u.searchParams.get("error_description") ?? u.searchParams.get("error") ?? "bad answer from Linear"));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Linear is connected. You can close this tab.");
        resolve(u.searchParams.get("code"));
      });
    });
    console.log(`Opening Linear in your browser. If it doesn't open, visit:\n${url}`);
    execFile("open", [url], () => {});
    const t = await postForm(`${BASE}/token`, { grant_type: "authorization_code", code: await code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier });
    await save({ client_id: reg.client_id, ...tokens(t) });
    console.log("Connected.");
  } finally {
    server.close();
  }
}

async function accessToken() {
  const t = await load();
  if (!t?.access_token) throw new Error("not connected: run linear-me login");
  if (t.expires_at - 60000 > Date.now()) return t.access_token;
  if (!t.refresh_token) throw new Error("session expired: run linear-me login");
  const refreshed = await postForm(`${BASE}/token`, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id })
    .catch((e) => { throw /invalid_grant/.test(e.message) ? new Error("session expired: run linear-me login") : e; });
  const fresh = { ...t, ...tokens(refreshed, t) };
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
  if (res.status === 401) throw new Error("Linear refused the session: run linear-me login");
  if (!res.ok && res.status !== 202) throw new Error(`MCP: HTTP ${res.status} ${await res.text()}`);
  return { session: res.headers.get("mcp-session-id") ?? session, message: parseRpc(await res.text(), res.headers.get("content-type") ?? "") };
}

async function session() {
  const token = await accessToken();
  const init = await rpc(token, null, { jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "herdr-linear", version: "1" } } });
  if (init.message?.error) throw new Error(init.message.error.message);
  await rpc(token, init.session, { jsonrpc: "2.0", method: "notifications/initialized" });
  let id = 1;
  return async (method, params) => {
    const r = await rpc(token, init.session, { jsonrpc: "2.0", id: ++id, method, params });
    if (r.message?.error) throw new Error(r.message.error.message);
    return r.message?.result;
  };
}

export async function mcp(method, params) {
  return (await session())(method, params);
}

export const READ_ONLY = /^(get|list)_|^whoami$/;

export async function batch(calls, send = null) {
  if (!Array.isArray(calls) || calls.some((c) => !READ_ONLY.test(String(c?.tool)))) throw new Error("batch takes read-only tools only (get_*, list_*, whoami)");
  const call = send ?? (await session());
  return Promise.all(calls.map(async (c) => {
    try {
      const result = await call("tools/call", { name: c.tool, arguments: c.args ?? {} });
      if (result?.isError) { const v = resultValue(result); return { ok: false, error: typeof v === "string" ? v : JSON.stringify(v) }; }
      return { ok: true, value: resultValue(result) };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }));
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

async function tool(name, args) {
  const result = await mcp("tools/call", { name, arguments: args });
  if (result?.isError) throw new Error(String(resultValue(result)));
  return resultValue(result);
}

const hc = (args) => new Promise((resolve, reject) => {
  execFile("hc", args, (e, stdout, stderr) => (e ? reject(new Error(String(stderr || e.message).trim())) : resolve(stdout)));
});

export function newComments(comments, since, me) {
  return comments.filter((c) => c.createdAt > since && c.author?.id !== me).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function wakeMessage(id, fresh) {
  const who = [...new Set(fresh.map((c) => c.author?.name ?? "someone"))].join(", ").replace(/[^\p{L}\p{N} .,_-]/gu, "");
  return `[linear-watch] ${id}: ${fresh.length} new comment(s) on the issue from ${who}. Read them and do the follow-up of the skill that watches ${id} (sdlc-watch-mr in workflow-linear-build).`;
}

export const KINDS = { comments: "linear.watch.", mr: "linear.mr.", pipeline: "linear.pipeline." };
const TARGET = { mr: /^([\w.-]+(?:\/[\w.-]+)+)!(\d+)(?:@(\d{4}-\d\d-\d\dT[\d:.]+Z))?$/, pipeline: /^([\w.-]+(?:\/[\w.-]+)+)#(\d+)$/ };
const SETTLED = new Set(["success", "failed", "canceled", "skipped", "manual"]);

export function watchesOf(terminal) {
  const out = [];
  for (const [k, value] of Object.entries(terminal.labels ?? {})) {
    for (const [kind, prefix] of Object.entries(KINDS)) {
      const id = k.startsWith(prefix) ? k.slice(prefix.length) : null;
      if (id && ISSUE_ID.test(id) && value && (kind === "comments" || TARGET[kind].test(value))) out.push({ kind, id, value });
    }
  }
  return out;
}

export const canWake = (t) => t.agent === "claude-code" && t.status === "done";

export function mrOutcome(target, mr, pipeline) {
  if (mr?.state === "closed") return `merge request ${target} was closed without merging.`;
  if (mr?.state !== "merged" || !pipeline || !SETTLED.has(pipeline.status)) return null;
  return `merge request ${target} is merged and its pipeline ${Number(pipeline.id)} is ${pipeline.status}.`;
}

export function mrNotes(notes, since, me) {
  return notes.filter((n) => !n.system && n.created_at > since && n.author?.username !== me).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function notesText(ref, fresh) {
  const who = [...new Set(fresh.map((n) => n.author?.username ?? "someone"))].join(", ").replace(/[^\p{L}\p{N} .,_-]/gu, "");
  return `${fresh.length} new comment(s) on merge request ${ref} from ${who}. Read them`;
}

export function pipelineOutcome(target, pipeline) {
  return pipeline && SETTLED.has(pipeline.status) ? `pipeline ${target} is ${pipeline.status}.` : null;
}

const glab = (path) => new Promise((resolve, reject) => {
  execFile("glab", ["api", path], { maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) => (e ? reject(new Error(String(stderr || e.message).trim())) : resolve(JSON.parse(stdout))));
});

export async function checkMr(target, me) {
  const [, project, iid, since] = target.match(TARGET.mr);
  const enc = encodeURIComponent(project), ref = `${project}!${iid}`;
  const mr = await glab(`projects/${enc}/merge_requests/${iid}`);
  if (mr.state === "merged" || mr.state === "closed") {
    let pipeline = null;
    for (const sha of mr.state === "merged" ? [mr.merge_commit_sha, mr.squash_commit_sha, mr.sha].filter(Boolean) : []) {
      const list = await glab(`projects/${enc}/pipelines?sha=${sha}&ref=${encodeURIComponent(mr.target_branch)}`);
      if (list.length) { pipeline = list[0]; break; }
    }
    const text = mrOutcome(ref, mr, pipeline);
    return text ? { text, done: true } : null;
  }
  if (!since) return null;
  const fresh = mrNotes(await glab(`projects/${enc}/merge_requests/${iid}/notes?sort=desc&order_by=created_at&per_page=50`), since, me);
  return fresh.length ? { text: `${notesText(ref, fresh)} and`, value: `${ref}@${fresh.at(-1).created_at}` } : null;
}

export async function checkPipeline(target) {
  const [, project, id] = target.match(TARGET.pipeline);
  const text = pipelineOutcome(target, await glab(`projects/${encodeURIComponent(project)}/pipelines/${id}`));
  return text ? { text, done: true } : null;
}

async function watched() {
  const { terminals = [] } = JSON.parse(await hc(["ls", "--json"]));
  const out = [];
  for (const t of terminals) {
    const full = JSON.parse(await hc(["get", t.address, "--json"]).catch(() => "{}"));
    for (const w of watchesOf(full)) out.push({ ...w, terminal: t.address, wake: canWake(t) });
  }
  return out;
}

function checkId(id) {
  if (!ISSUE_ID.test(id ?? "")) throw new Error(`not an issue identifier: ${id}`);
  const term = process.env.HC_TERMINAL_ID;
  if (!term) throw new Error("run it from a Herdr terminal (HC_TERMINAL_ID is not set)");
  return term;
}

async function ensureWatcher() {
  const { terminals = [] } = JSON.parse(await hc(["ls", "--json"]));
  if (terminals.some((t) => t.name === WATCHER)) return "running";
  try {
    await hc(["run", "--bg", "--rm", "--no-parent", "--no-notify", "--name", WATCHER, "--", "caffeinate", "-i", process.execPath, fileURLToPath(import.meta.url), "watcher"]);
    return "started";
  } catch (e) {
    if (/name/i.test(String(e.message))) return "running";
    throw e;
  }
}

async function watch(kind, id, project, number) {
  const term = checkId(id);
  const now = new Date().toISOString();
  const value = kind === "comments" ? now : kind === "mr" ? `${project}!${number}@${now}` : `${project}#${number}`;
  if (kind !== "comments" && !TARGET[kind].test(value)) throw new Error(`expected <group/project> <number>, got ${project} ${number}`);
  await hc(["label", term, `${KINDS[kind]}${id}=${value}`]);
  return { issue: id, kind, value, terminal: term, watcher: await ensureWatcher() };
}

async function unwatch(id, kind) {
  const term = checkId(id);
  if (kind && !KINDS[kind]) throw new Error(`kind is one of ${Object.keys(KINDS).join(", ")}`);
  await hc(["label", term, ...(kind ? [KINDS[kind]] : Object.values(KINDS)).map((prefix) => `${prefix}${id}=`)]);
  return { issue: id, kind: kind ?? "all", terminal: term };
}

async function watcher({ every, once }) {
  const me = (await tool("whoami", {}))?.user?.id;
  const gitlabMe = await glab("user").then((u) => u.username).catch(() => null);
  for (;;) {
    const list = await watched().catch(() => null);
    if (list && !list.length) return;
    const ready = (list ?? []).filter((w) => w.wake);
    const onComments = ready.filter((w) => w.kind === "comments");
    for (const id of new Set(onComments.map((w) => w.id))) {
      const comments = await tool("list_comments", { issueId: id }).then((v) => v?.comments ?? []).catch(() => null);
      if (!comments) continue;
      for (const w of onComments.filter((x) => x.id === id)) {
        const fresh = newComments(comments, w.value, me);
        if (!fresh.length) continue;
        await hc(["send", w.terminal, wakeMessage(id, fresh)]).catch(() => {});
        await hc(["label", w.terminal, `${KINDS.comments}${id}=${fresh.at(-1).createdAt}`]).catch(() => {});
      }
    }
    for (const w of ready.filter((x) => x.kind !== "comments")) {
      const r = await (w.kind === "mr" ? checkMr(w.value, gitlabMe) : checkPipeline(w.value)).catch(() => null);
      if (!r) continue;
      const tail = `${r.done ? "Do" : "do"} the follow-up of the skill that watches ${w.id} (sdlc-watch-mr or sdlc-deploy).`;
      await hc(["send", w.terminal, `[linear-watch] ${w.id}: ${r.text} ${tail}`]).catch(() => {});
      await hc(["label", w.terminal, `${KINDS[w.kind]}${w.id}=${r.done ? "" : r.value}`]).catch(() => {});
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, every * 1000));
  }
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
  if (command === "batch" && rest[0]) { console.log(JSON.stringify({ ok: true, value: await batch(await readArgs(rest[0])) })); return; }
  if (command === "watch" && rest[0]) { console.log(JSON.stringify({ ok: true, value: await watch("comments", rest[0]) })); return; }
  if (command === "watch-mr" && rest[2]) { console.log(JSON.stringify({ ok: true, value: await watch("mr", ...rest) })); return; }
  if (command === "watch-pipeline" && rest[2]) { console.log(JSON.stringify({ ok: true, value: await watch("pipeline", ...rest) })); return; }
  if (command === "unwatch" && rest[0]) { console.log(JSON.stringify({ ok: true, value: await unwatch(rest[0], rest[1]) })); return; }
  if (command === "watcher") {
    const every = Number(rest[rest.indexOf("--every") + 1]);
    return watcher({ every: rest.includes("--every") && every > 0 ? every : 120, once: rest.includes("--once") });
  }
  console.error("usage: linear-me login | logout | status | tools | call <tool> [json | - (stdin) | @file] | batch <[{ tool, args }] json | - | @file> | watch <ID> | watch-mr <ID> <group/project> <iid> | watch-pipeline <ID> <group/project> <pipeline> | unwatch <ID> [comments|mr|pipeline] | watcher [--every s] [--once]");
  process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e) })); process.exitCode = 1; });
}
