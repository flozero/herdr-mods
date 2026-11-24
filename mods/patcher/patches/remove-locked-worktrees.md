# remove-locked-worktrees

Remove worktree handles a locked worktree (`git worktree lock`, or an app keeping its
worktrees locked): the dialog says it's locked, the first Enter asks again, the second
removes it, overriding the lock.

Made on top of: `worktree-settings` (the lock check goes before its teardown).

## What it does

In `mods/worktree` → `my-worktree` (Remove worktree):

- When it opens, it reads the lock: "It's locked by supacode: removing it overrides the
  lock." A JSON reason with an `owner` reads as "by <owner>", any other reason shows in
  parentheses.
- The first Enter on a locked worktree removes nothing: "It's locked by …. Enter again
  overrides the lock and removes it."
- The second Enter runs the teardown and
  `git worktree remove --force --force` (git needs `--force` twice for a lock; it also
  covers uncommitted changes and submodules).
- Unlocked worktrees are removed exactly as before.

## What it expects from Herdr's original

`mods/worktree/main.js`:

- `submodules(top, on)` ends with `return { mods, unpushed };`: `lockOf` and `lockedBy` go
  right after it. `lockOf` reads `<git dir>/locked` (`git rev-parse --absolute-git-dir`)
  with `readTextFile`.
- `init()`: `this.unpushed = [];` followed by `cx.spawn(`; `this.locked = null;` goes
  between them. The remove branch reads
  `this.unpushed = (await submodules(repo.top, this.on)).unpushed;`, the lock is read after it.
- `remove()`: `if (changed) return "It changed since this opened. …";`, the lock check goes
  right after it; then `git(this.repo.main, ["worktree", "remove", ...(force ? ["--force"] : []), this.repo.top], this.on, 600_000)`.
- `render()`: the `.when(remove && this.unpushed.length > 0, …)` warning; the lock warning
  goes after it.

Since Herdr 0.1.17, `remove()` reads `git worktree list --porcelain` and refuses a locked
worktree: `const lock = checkout?.find(…)` followed by
`if (lock) return lock === "locked" ? "This worktree is locked." : …;`. This patch replaces
those two lines with the second Enter (`list` and `checkout` stay as Herdr has them, and the
`git worktree list` error still stops the removal). Since Herdr 0.1.18 the space closes first and `remove()` waits for its terminals to stop
before git removes the checkout, on every platform, as in Herdr.

## How to check it works

- `git worktree lock --reason '{"owner":"supacode"}' <worktree>`, Remove worktree on its
  space: "It's locked by supacode: removing it overrides the lock."
- Enter: "Enter again overrides the lock and removes it.", nothing removed.
- Enter again: the space closes, `git worktree list` no longer shows it.
