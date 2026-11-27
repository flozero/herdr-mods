import test from "node:test";
import assert from "node:assert/strict";
import { stackTree } from "../mods/gitlab-review/stack.js";

const mr = (iid, source, target = "main") => ({ m: { iid, source_branch: source, target_branch: target } });
const shape = (rows) => rows.map((x) => `${"  ".repeat(x.depth)}${x.m.iid}${x.kids ? `(${x.kids}${x.folded ? " folded" : ""})` : ""}${x.stackedOn ? ` on ${x.stackedOn}` : ""}`);

test("stacked merge requests go under their parent, in order", () => {
  const rows = [mr(3, "c", "b"), mr(1, "a"), mr(9, "z"), mr(2, "b", "a")];
  assert.deepEqual(shape(stackTree(rows, new Set(), "main")), ["1(1)", "  2(1)", "    3", "9"]);
});

test("a folded parent hides the whole stack under it", () => {
  const rows = [mr(1, "a"), mr(2, "b", "a"), mr(3, "c", "b"), mr(4, "d", "a")];
  assert.deepEqual(shape(stackTree(rows, new Set([2]), "main")), ["1(2)", "  2(1 folded)", "  4"]);
  assert.deepEqual(shape(stackTree(rows, new Set([1]), "main")), ["1(2 folded)"]);
});

test("a parent missing from the list leaves the child on top, with its target", () => {
  assert.deepEqual(shape(stackTree([mr(5, "e", "elsewhere")], new Set(), "main")), ["5 on elsewhere"]);
});

test("a loop between branches still shows every merge request once", () => {
  const rows = [mr(1, "a", "b"), mr(2, "b", "a")];
  assert.deepEqual(stackTree(rows, new Set(), "main").map((x) => x.m.iid).sort(), [1, 2]);
});
