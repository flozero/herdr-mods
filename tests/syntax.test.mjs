import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { syntaxOf } = await import(join(dirname(fileURLToPath(import.meta.url)), "../mods/code/syntax.js"));

const extensionOf = (path) => (/\.([^./]+)$/.exec(path)?.[1] ?? "").toLowerCase();
const syntax = (name, language) => syntaxOf(name, extensionOf(name), language);

test("a .env file is coloured as shell, whatever follows the dot", () => {
  for (const name of [".env", ".env.local", ".env.example", ".env.production", ".env.test.local", "prod.env", ".envrc", ".ENV"]) {
    assert.equal(syntax(name), "bash", name);
  }
});

test("a file that only has env in its name is not one", () => {
  assert.equal(syntax("env.d.ts"), "ts");
  assert.equal(syntax("environment.ts"), "ts");
  assert.equal(syntax("config.env.ts"), "ts");
  assert.equal(syntax("env"), "");
});

test("JSON and its relatives use the JSON grammar", () => {
  assert.equal(syntax("package.json"), "json");
  assert.equal(syntax("tsconfig.json"), "json");
  assert.equal(syntax("settings.jsonc"), "json");
  assert.equal(syntax("data.json5"), "json");
  assert.equal(syntax("site.webmanifest"), "json");
});

test("a language's own grammar wins, and any other file keeps its extension", () => {
  assert.equal(syntax(".env", { syntax: "js" }), "js");
  assert.equal(syntax("page.vue", { syntax: "html" }), "html");
  assert.equal(syntax("main.rs"), "rs");
  assert.equal(syntax("README.md"), "md");
  assert.equal(syntax("docker-compose.yml"), "yml");
});
