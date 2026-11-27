import test from "node:test";
import assert from "node:assert/strict";
import { saveTemplate, deleteTemplate, parentChoices, startTask } from "../mods/linear/prompts.js";

test("a template is added, a same name replaces it, an empty one is ignored", () => {
  let l = saveTemplate([], "Fix", "fix it\n- **now**");
  assert.deepEqual(l, [{ name: "Fix", text: "fix it\n- **now**" }]);
  l = saveTemplate(l, " fix ", "again");
  assert.deepEqual(l, [{ name: "fix", text: "again" }]);
  assert.equal(saveTemplate(l, "  ", "x"), l);
  assert.equal(saveTemplate(l, "x", " "), l);
  assert.deepEqual(deleteTemplate(l, "fix"), []);
});

test("a new worktree only in the parent repo", () => {
  const c = [{ kind: "tab", rank: 3 }, { kind: "worktree", rank: 1, folder: "/a" }, { kind: "open", rank: 0 }, { kind: "worktree", rank: 2, folder: "/c" }];
  assert.deepEqual(parentChoices(c, { folder: "/a" }, null).map((x) => x.folder ?? x.kind), ["tab", "/a", "open"]);
  const made = { kind: "worktree", rank: 2, folder: "/z" };
  assert.deepEqual(parentChoices(c, { folder: "/z" }, made).map((x) => x.folder ?? x.kind), ["tab", "/z", "open"]);
  assert.deepEqual(parentChoices(c, null, null).map((x) => x.kind), ["tab", "open"]);
});

test("the typed prompt comes before the issue context", () => {
  assert.equal(startTask("  do X  ", "Issue PLA-1"), "do X\n\nIssue PLA-1");
  assert.equal(startTask("", "Issue PLA-1"), "Issue PLA-1");
});
