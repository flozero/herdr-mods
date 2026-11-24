import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const code = join(dirname(fileURLToPath(import.meta.url)), "../mods/code");
const { dockerLanguage, DOCKERFILE_LANGUAGE, COMPOSE_LANGUAGE } = await import(join(code, "docker.js"));
const { plainSnippet, plainCompletion } = await import(join(code, "snippet.js"));

test("Dockerfiles are found by name", () => {
  for (const name of ["Dockerfile", "dockerfile", "Dockerfile.dev", "Dockerfile.prod.alpine", "api.Dockerfile", "web.dockerfile", "Containerfile", "app.Containerfile"]) {
    assert.equal(dockerLanguage(name), DOCKERFILE_LANGUAGE, name);
  }
});

test("Compose files are found by name", () => {
  for (const name of ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml", "docker-compose.override.yml", "compose.prod.yaml", "docker-compose-dev.yml", "Docker-Compose.yml"]) {
    assert.equal(dockerLanguage(name), COMPOSE_LANGUAGE, name);
  }
});

test("other files are left to their own language", () => {
  for (const name of ["config.yml", "values.yaml", "composer.json", "composer.yml", "Dockerfiles", "mydockerfile", "dockerfile-notes.md", "docker-compose", "compose.yml.bak", "main.js", ".dockerignore"]) {
    assert.equal(dockerLanguage(name), null, name);
  }
});

test("each Docker language has its own server and language id", () => {
  assert.deepEqual([DOCKERFILE_LANGUAGE.servers, DOCKERFILE_LANGUAGE.id], [["dockerfile"], "dockerfile"]);
  assert.deepEqual([COMPOSE_LANGUAGE.servers, COMPOSE_LANGUAGE.id], [["compose"], "dockercompose"]);
});

test("a snippet's placeholders keep their text and its tab stops go", () => {
  assert.equal(plainSnippet("build: ${1:path}$0"), "build: path");
  assert.equal(plainSnippet("version: '${1:version}'$0"), "version: 'version'");
  assert.equal(plainSnippet("a ${1|x,y,z|} b $2 ${3} $0"), "a x b   ");
  assert.equal(plainSnippet("${1:outer ${2:inner}}"), "outer inner");
  assert.equal(plainSnippet("plain text"), "plain text");
});

test("escaped characters are kept, not taken for tab stops", () => {
  assert.equal(plainSnippet("echo \\${1:x} \\$2 \\\\ \\}"), "echo ${1:x} $2 \\ }");
});

test("the lines after the first follow the line's indentation, tabs becoming the language's unit", () => {
  const snippet = "build:\n\tcontext: ${1:contextPath}\n\tdockerfile: ${2:Dockerfile}";
  assert.equal(plainSnippet(snippet, "    ", "  "), "build:\n      context: contextPath\n      dockerfile: Dockerfile");
  assert.equal(plainSnippet(snippet), "build:\n\tcontext: contextPath\n\tdockerfile: Dockerfile");
  assert.equal(plainSnippet("a:\n\n\tb", "  ", "  "), "a:\n\n    b", "empty lines get no trailing spaces");
  assert.equal(plainSnippet("a:\n\t\tb", "", "  "), "a:\n    b", "each tab is one unit");
});

test("only snippet items are changed, and the rest of the item stays", () => {
  const plain = { label: "services:", insertText: "services:\n", insertTextFormat: 1 };
  assert.equal(plainCompletion(plain, "  ", "  "), plain);
  const edit = { label: "FROM", textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, newText: "FROM" } };
  assert.equal(plainCompletion(edit, "", "\t"), edit);
  assert.equal(plainCompletion(undefined, "", "\t"), undefined);

  const snippet = { label: "build:", detail: "Long form", insertText: "build:\n\tcontext: ${1:contextPath}", insertTextFormat: 2 };
  assert.deepEqual(plainCompletion(snippet, "  ", "  "), { label: "build:", detail: "Long form", insertText: "build:\n    context: contextPath", insertTextFormat: 1 });
  assert.equal(snippet.insertTextFormat, 2, "the answer is not changed in place");

  const replaced = { label: "x", textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "k: ${1:v}" }, insertTextFormat: 2 };
  const result = plainCompletion(replaced, "", "  ");
  assert.equal(result.textEdit.newText, "k: v");
  assert.deepEqual(result.textEdit.range, replaced.textEdit.range);
});
