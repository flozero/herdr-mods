# sync-existing-worktrees

Sync worktrees, in a space's menu and in the + menu: every worktree of the space's repo that
has no space gets one, the way `worktree-sync` does for new ones. `worktree-sync` only adds
worktrees made after it first saw the repo; this covers the ones that were already there.

Made on top of: `new-space-here` (it goes after every other patch).

## What it does

- `mods/menu` → `my-menu`: the space menu of a git space gets **Sync worktrees** after
  Open worktree, with the branch icon.
- `mods/new-menu` → `my-new-menu`: **Sync worktrees** after Open worktree…; the agent list
  gives it one row so the popup keeps its height.
- Both set the shared value `worktree-sync.request` to `{ space, at }`. `worktree-sync`
  picks it up, lists the repo's worktrees and opens a space (in the background) for each one
  without a space, then says how many it added.

## What it expects from Herdr's original

- `mods/menu/main.js`: the `herdr` import line, the `case "space":` list with
  `["Open worktree", "worktree", { space: tg.id, action: "open" }]`, `menuIcon`'s
  `command === "worktree" ? "git-branch"`, and `choose()` ending with `else run(it[1], it[2]);`.
- `mods/new-menu/main.js`: the popup height `h(Math.min(491, 167 + …))` and the
  `worktree-open` row, last child of the menu.

## How to check it works

- In a repo with worktrees that have no space (made before `worktree-sync` ran): right-click
  the repo's space, **Sync worktrees**: their spaces appear under it and a toast says how many.
- Again: "Every worktree already has its space."
