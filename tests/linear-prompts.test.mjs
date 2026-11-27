import test from "node:test";
import assert from "node:assert/strict";
import { saveTemplate, deleteTemplate, worktreeChoices, startTask } from "../mods/linear/prompts.js";

test("a template is added, a same name replaces it, an empty one is ignored", () => {
  let l = saveTemplate([], "Fix", "fix it\n- **now**");
  assert.deepEqual(l, [{ name: "Fix", text: "fix it\n- **now**" }]);
  l = saveTemplate(l, " fix ", "again");
  assert.deepEqual(l, [{ name: "fix", text: "again" }]);
  assert.equal(saveTemplate(l, "  ", "x"), l);
  assert.equal(saveTemplate(l, "x", " "), l);
  assert.deepEqual(deleteTemplate(l, "fix"), []);
});

test("only worktree choices, in rank order", () => {
  const c = [{ kind: "tab" }, { kind: "worktree", repo: "a/b" }, { kind: "open" }, { kind: "worktree", repo: "c/d" }];
  assert.deepEqual(worktreeChoices(c).map((x) => x.repo), ["a/b", "c/d"]);
  assert.deepEqual(worktreeChoices([]), []);
});

test("the typed prompt comes before the issue context", () => {
  assert.equal(startTask("  do X  ", "Issue PLA-1"), "do X\n\nIssue PLA-1");
  assert.equal(startTask("", "Issue PLA-1"), "Issue PLA-1");
});
