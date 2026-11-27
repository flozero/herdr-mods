#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { METHODS, BODY_TYPES, normalize, safeName, varsIn } from "../request.js";

const ROOT = path.join(os.homedir(), ".herdr", "http");

const INSTRUCTIONS = `The HTTP client in Herdr. You write requests; the person sends them from the HTTP pane beside this terminal (you can't send them).
Requests are kept by project in ~/.herdr/http/<project>/<name>.json; the project defaults to this repository's name.
{{name}} in the URL, headers, body or form is a variable. A request's \`set\` fills variables from its response, for the requests after it: {"key": "token", "value": "body.data.token"} (also status, header.<name>, body, body.items[0].id). Write a login request that sets a token, then requests that send "Authorization: Bearer {{token}}".
Variables can also hold a base URL: {{base}}/users. The person fills a variable's value in the pane's Variables list when no request sets it.
Call open_request after saving so the person sees it.`;

const row = { type: "object", properties: { key: { type: "string" }, value: { type: "string" }, on: { type: "boolean", description: "false keeps it but doesn't send it" } }, required: ["key"] };
const rows = (description) => ({ description, oneOf: [{ type: "array", items: row }, { type: "object", additionalProperties: { type: "string" } }] });
const where = {
  project: { type: "string", description: "Default: this repository's name (or the current folder's)" },
  name: { type: "string", description: "The request's name, e.g. \"login\" or \"list users\"" },
};

const TOOLS = [
  { name: "list_requests", description: "The saved projects and requests: method, URL, the variables each uses and sets.",
    inputSchema: { type: "object", properties: { project: { type: "string", description: "Only this project" } } } },
  { name: "read_request", description: "One saved request, in full.",
    inputSchema: { type: "object", properties: where, required: ["name"] } },
  { name: "save_request", description: "Create a request, or replace one with the same name. It is not sent: the person sends it from the HTTP pane.",
    inputSchema: { type: "object", properties: {
      ...where,
      method: { type: "string", enum: METHODS },
      url: { type: "string", description: "With its query; {{var}} allowed" },
      headers: rows("Headers, as {\"Accept\": \"application/json\"} or a list of {key, value, on}. Content-Type comes from bodyType unless set here."),
      bodyType: { type: "string", enum: BODY_TYPES.map((b) => b.id), description: "json, text, xml: `body` is sent. form (urlencoded) and multipart: `form` is sent; a multipart value starting with @ is a file path." },
      body: { type: "string", description: "The body text for json, text and xml" },
      form: rows("The fields for form and multipart"),
      set: rows("Variables to set from the response: key is the variable, value where to read it (status, header.Location, body, body.data.token, body.items[0].id)"),
      notes: { type: "string", description: "A line for the person: what it does, what to fill first" },
    }, required: ["name", "method", "url"] } },
  { name: "delete_request", description: "Move a saved request to ~/.herdr/http/.trash.",
    inputSchema: { type: "object", properties: where, required: ["name"] } },
  { name: "open_request", description: "Show a saved request in the HTTP pane beside this terminal, opening the pane if needed, for the person to send.",
    inputSchema: { type: "object", properties: where, required: ["name"] } },
];

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (e, stdout, stderr) => (e ? reject(new Error(String(stderr || e.message).trim())) : resolve(stdout)));
});

const last = (p) => String(p ?? "").replace(/\/+$/, "").split("/").pop();

async function defaultProject() {
  let common = "";
  try { common = (await run("git", ["-C", process.cwd(), "rev-parse", "--path-format=absolute", "--git-common-dir"])).trim(); } catch {}
  const dir = common.replace(/\/+$/, "");
  const name = dir ? (last(dir) === ".git" ? last(path.dirname(dir)) : last(dir).replace(/\.git$/, "")) : last(process.cwd());
  return safeName(name) || "requests";
}

async function locate({ project, name }) {
  const p = safeName(project ?? "") || (await defaultProject());
  const n = safeName(name ?? "");
  if (!n) throw new Error("a name is needed (letters, digits, . _ - and spaces)");
  return { project: p, name: n, file: path.join(ROOT, p, `${n}.json`) };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
}

async function writeAtomic(file, text) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

async function listRequests({ project } = {}) {
  const dirs = (await fs.readdir(ROOT, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && (!project || d.name === safeName(project)));
  const out = [];
  for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const files = (await fs.readdir(path.join(ROOT, d.name)).catch(() => [])).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort();
    const requests = [];
    for (const f of files) {
      const r = normalize((await readJson(path.join(ROOT, d.name, f)).catch(() => null)) ?? {});
      const text = [r.url, ...r.headers.map((h) => `${h.key} ${h.value}`), r.body, ...r.form.map((x) => `${x.key} ${x.value}`)].join("\n");
      requests.push({ name: f.slice(0, -5), method: r.method, url: r.url, bodyType: r.bodyType,
        uses: [...new Set(varsIn(text))], sets: r.set.filter((s) => s.on).map((s) => s.key) });
    }
    out.push({ project: d.name, requests });
  }
  return JSON.stringify(out.length ? out : "No saved requests yet", null, 2);
}

async function readRequest(args) {
  const { project, name, file } = await locate(args);
  const data = await readJson(file);
  if (!data) throw new Error(`no request ${name} in ${project}`);
  return JSON.stringify({ project, name, ...normalize(data) }, null, 2);
}

async function saveRequest(args) {
  const { project, name, file } = await locate(args);
  const existed = Boolean(await readJson(file).catch(() => null));
  await ensureDir(ROOT);
  await ensureDir(path.join(ROOT, project));
  await fs.writeFile(path.join(ROOT, project, ".herdr-project"), "", { flag: "a" });
  const data = normalize(args);
  await writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
  return `${existed ? "Replaced" : "Saved"} ${project} / ${name} (${data.method} ${data.url}) in ${file}. open_request shows it to the person.`;
}

async function deleteRequest(args) {
  const { project, name, file } = await locate(args);
  const trash = path.join(ROOT, ".trash");
  await ensureDir(trash);
  try { await fs.rename(file, path.join(trash, `${project} -- ${name} -- ${Date.now()}.json`)); }
  catch (e) { if (e.code === "ENOENT") throw new Error(`no request ${name} in ${project}`); throw e; }
  return `Moved ${project} / ${name} to ${trash}`;
}

async function myPlace() {
  const term = process.env.HC_TERMINAL_ID;
  if (!term) return {};
  const ls = JSON.parse(await run("herdr-app", ["ls"]));
  for (const s of ls.spaces ?? []) for (const t of s.tabs ?? []) for (const x of t.terminals ?? []) if (x.terminal === term) return { pane: x.pane, tab: t.id };
  return {};
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function openRequest(args) {
  const { project, name, file } = await locate(args);
  if (!(await readJson(file))) throw new Error(`no request ${name} in ${project}: save_request first`);
  const place = await myPlace().catch(() => ({}));
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeAtomic(path.join(ROOT, ".open.json"), JSON.stringify({ id, project, name }));
  for (let i = 0; i < 8; i++) {
    await pause(150);
    const ack = await readJson(path.join(ROOT, ".opened.json")).catch(() => null);
    if (ack?.id === id && (!place.tab || ack.tabs?.includes(place.tab))) return `Shown in the HTTP pane: ${project} / ${name}`;
  }
  await run("herdr-app", ["do", "pane.split", JSON.stringify({ direction: "right", ...(place.pane ? { pane: place.pane } : {}), mod: "http", props: { project, name } })]);
  return `Opened the HTTP pane beside you with ${project} / ${name}`;
}

async function call(name, args = {}) {
  if (name === "list_requests") return listRequests(args);
  if (name === "read_request") return readRequest(args);
  if (name === "save_request") return saveRequest(args);
  if (name === "delete_request") return deleteRequest(args);
  if (name === "open_request") return openRequest(args);
  throw new Error(`unknown tool ${name}`);
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return;
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} },
      serverInfo: { name: "herdr-http", version: "1" }, instructions: INSTRUCTIONS,
    } });
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    try {
      const text = await call(params?.name, params?.arguments ?? {});
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e?.message ?? e) }], isError: true } });
    }
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
}

const queue = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) await handle(queue.shift()).catch(() => {});
  busy = false;
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try { queue.push(JSON.parse(line)); } catch { return; }
  pump();
});
