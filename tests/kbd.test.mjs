import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const COPIES = ["linear", "gitlab-review", "sentry", "http"].map((m) => join(here, "../mods", m, "kbd.js"));
const { keyLabels } = await import(COPIES[0]);

test("every mod carries the same kbd.js", () => {
  const first = readFileSync(COPIES[0], "utf8");
  for (const file of COPIES) assert.equal(readFileSync(file, "utf8"), first, file);
});

test("macOS keeps ⌘↵", () => {
  const hint = "Send  ⌘↵ · ⌘Enter save · ⌥↵ ask · ⌘R refresh";
  assert.equal(keyLabels(hint, "macos"), hint);
});

test("Linux and Windows say ⌃↵ where Super+Enter would start the terminal, and keep every other chord", () => {
  for (const platform of ["linux", "windows"]) {
    assert.equal(keyLabels("Send  ⌘↵", platform), "Send  ⌃↵");
    assert.equal(keyLabels("Markdown · ⌘Enter send · ⌥Enter ask", platform), "Markdown · ⌃Enter send · ⌥Enter ask");
    assert.equal(keyLabels("↻  ⌘R · Search  ⌘F · ⌘⇧C copy · ⇧D draft", platform), "↻  ⌘R · Search  ⌘F · ⌘⇧C copy · ⇧D draft");
  }
});

test("an unknown platform (window() is null without a window) and non-text pass through", () => {
  assert.equal(keyLabels("Send  ⌘↵", undefined), "Send  ⌘↵");
  assert.equal(keyLabels("Send  ⌘↵", null), "Send  ⌘↵");
  assert.equal(keyLabels(12, "linux"), 12);
});
