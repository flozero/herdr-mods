import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { resolve, substitute, extract, setFrom, curlArgs, curlCommand, bodyTypeOf, normalize, buildUrl, parseQuery } from "../mods/http/request.js";

const server = join(dirname(fileURLToPath(import.meta.url)), "../mods/http/mcp/server.mjs");

test("{{name}} takes its value, and an unknown one is reported and left as written", () => {
  const missing = new Set();
  assert.equal(substitute("{{base}}/users/{{ id }}?t={{nope}}", { base: "https://x.dev", id: 42 }, missing), "https://x.dev/users/42?t={{nope}}");
  assert.deepEqual([...missing], ["nope"]);
});

test("a JSON body gets its Content-Type, unless a header sets one", () => {
  const r = resolve({ method: "POST", url: "{{base}}/login", bodyType: "json", body: '{"u":"{{user}}"}', headers: [] }, { base: "https://x.dev", user: "ada" });
  assert.equal(r.url, "https://x.dev/login");
  assert.equal(r.data, '{"u":"ada"}');
  assert.deepEqual(r.headers, ["Content-Type: application/json"]);
  const own = resolve({ method: "POST", url: "u", bodyType: "json", body: "{}", headers: { "content-type": "application/vnd.api+json" } });
  assert.deepEqual(own.headers, ["content-type: application/vnd.api+json"]);
});

test("a GET sends no body and no Content-Type", () => {
  const r = resolve({ method: "GET", url: "u", bodyType: "json", body: "{}" });
  assert.equal(r.data, null);
  assert.deepEqual(r.headers, []);
});

test("a form is urlencoded, a multipart value starting with @ is a file", () => {
  const form = resolve({ method: "POST", url: "u", bodyType: "form", form: [{ key: "q", value: "a b&{{x}}" }, { key: "off", value: "1", on: false }] }, { x: "é" });
  assert.equal(form.data, "q=a%20b%26%C3%A9");
  assert.deepEqual(form.headers, ["Content-Type: application/x-www-form-urlencoded"]);
  const multi = resolve({ method: "POST", url: "u", bodyType: "multipart", form: { name: "ada", photo: "@~/p.png" } });
  assert.deepEqual(multi.parts, [{ key: "name", value: "ada" }, { key: "photo", file: "~/p.png" }]);
  assert.deepEqual(multi.headers, []);
  const args = curlArgs({ method: "POST", url: "u", outFile: "o", headersOut: "d", parts: multi.parts, home: "/home/ada" });
  assert.ok(args.includes("--form-string") && args.includes("name=ada"));
  assert.ok(args.includes('photo=@"/home/ada/p.png"'));
  assert.equal(curlCommand({ ...multi, url: "u" }), "curl -X POST 'u' --form-string 'name=ada' -F 'photo=@~/p.png'");
});

test("a request saved before body types keeps sending its body", () => {
  assert.equal(bodyTypeOf({ body: '{"a":1}' }), "json");
  assert.equal(bodyTypeOf({ body: "<a/>" }), "xml");
  assert.equal(bodyTypeOf({ body: "hello" }), "text");
  assert.equal(bodyTypeOf({ body: "" }), "none");
  assert.equal(normalize({ method: "post", headers: "Accept: x\n# Off: y" }).headers[1].on, false);
});

test("variables are read from the status, a header or the JSON body", () => {
  const res = { status: 201, headers: [["Location", "/u/7"], ["X-Csrf", "abc"]], text: '{"data":{"token":"t0k","items":[{"id":3}],"a.b":{"c":true}}}' };
  assert.equal(extract("status", res), "201");
  assert.equal(extract("header.location", res), "/u/7");
  assert.equal(extract("body.data.token", res), "t0k");
  assert.equal(extract("$.data.items[0].id", res), "3");
  assert.equal(extract('body.data["a.b"].c', res), "true");
  assert.equal(extract("body.data.items", res), '[{"id":3}]');
  assert.throws(() => extract("body.data.nope", res), /nothing at body.data.nope/);
  const { values, errors } = setFrom([{ key: "token", value: "body.data.token" }, { key: "bad", value: "header.nope" }, { key: "off", value: "status", on: false }], res);
  assert.deepEqual(values, { token: "t0k" });
  assert.deepEqual(errors, ["bad: no nope header"]);
});

test("a {{variable}} in a query survives the params table rebuilding the URL", () => {
  const { base, pairs } = parseQuery("{{base}}/s?q={{term}}&n=1");
  assert.equal(buildUrl(base, pairs), "{{base}}/s?q={{term}}&n=1");
});

function mcp(home) {
  const p = spawn(process.execPath, [server], { env: { ...process.env, HOME: home, HC_TERMINAL_ID: "" }, cwd: home });
  let buf = "", n = 0;
  const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); }
  });
  const ask = (method, params) => new Promise((res) => { const id = ++n; waiting.set(id, res); p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); });
  const tool = async (name, args) => (await ask("tools/call", { name, arguments: args })).result;
  return { ask, tool, close: () => p.kill() };
}

test("the MCP saves, lists, reads and trashes requests, and can't send them", async () => {
  const home = mkdtempSync(join(tmpdir(), "http-mcp-"));
  const s = mcp(home);
  try {
    const tools = (await s.ask("tools/list")).result.tools.map((t) => t.name);
    assert.deepEqual(tools, ["list_requests", "read_request", "save_request", "delete_request", "open_request"]);
    const saved = await s.tool("save_request", { project: "api", name: "login", method: "POST", url: "{{base}}/login",
      bodyType: "json", body: '{"u":"{{user}}"}', set: { token: "body.token" } });
    assert.ok(!saved.isError, saved.content[0].text);
    const file = join(home, ".herdr/http/api/login.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(data.method, "POST");
    assert.deepEqual(data.set, [{ on: true, key: "token", value: "body.token" }]);
    const list = JSON.parse((await s.tool("list_requests", {})).content[0].text);
    assert.deepEqual(list[0].requests[0].uses, ["base", "user"]);
    assert.deepEqual(list[0].requests[0].sets, ["token"]);
    assert.equal(JSON.parse((await s.tool("read_request", { project: "api", name: "login" })).content[0].text).url, "{{base}}/login");
    assert.ok((await s.tool("read_request", { project: "api", name: "nope" })).isError);
    await s.tool("delete_request", { project: "api", name: "login" });
    assert.equal(existsSync(file), false);
  } finally {
    s.close();
  }
});
