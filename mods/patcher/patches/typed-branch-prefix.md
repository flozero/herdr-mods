# typed-branch-prefix

`worktrees.branchPrefix` also goes on a branch name typed by hand, not only on the one
Claude suggests.

Made on top of: `sync-existing-worktrees` (it goes after every other patch).

## What it does

- `mods/worktree` → `my-worktree`: `create()` puts the prefix in front of the typed name,
  unless the name already starts with it, the branch already exists, or the dialog was
  opened on a given branch (`props().branch`).
- The claim for `worktree-sync` moves from `work()` into `create()`, so it claims the final
  name, prefix included.

## What it expects from Herdr's original

- `mods/worktree/main.js`: `create()` starting with `const branch = this.text.trim();`, the
  `Type a branch name.` check, the `path` line and the `show-ref` existence check, and
  `work()` calling `claim(this.text.trim())` (from `sync-new-worktrees`).

## How to check it works

- With `"branchPrefix": "me/"`, New worktree, type `foo`: the branch is `me/foo`.
- Type `me/foo` or an existing branch: it is used as typed.
