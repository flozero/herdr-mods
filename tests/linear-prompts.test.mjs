import test from "node:test";
import assert from "node:assert/strict";
import { parentChoices } from "../mods/linear/prompts.js";

test("a new worktree only in the parent repo", () => {
  const c = [{ kind: "tab", rank: 3 }, { kind: "worktree", rank: 1, folder: "/a" }, { kind: "open", rank: 0 }, { kind: "worktree", rank: 2, folder: "/c" }];
  assert.deepEqual(parentChoices(c, { folder: "/a" }, null).map((x) => x.folder ?? x.kind), ["tab", "/a", "open"]);
  const made = { kind: "worktree", rank: 2, folder: "/z" };
  assert.deepEqual(parentChoices(c, { folder: "/z" }, made).map((x) => x.folder ?? x.kind), ["tab", "/z", "open"]);
  assert.deepEqual(parentChoices(c, null, null).map((x) => x.kind), ["tab", "open"]);
});
