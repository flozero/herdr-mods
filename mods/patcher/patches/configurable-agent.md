# configurable-agent

The agent New worktree starts, and the one that names the branch, come from
`~/.config/herdr-app/settings.json` instead of being `claude`.

Made on top of: `typed-branch-prefix` (it goes after every other patch).

## What it does

- `mods/worktree` → `my-worktree`: `worktreeSettings()` reads `worktrees.agent` (the
  command a first message starts, default `["claude"]`) and `worktrees.branchAgent` (the
  command that names the branch, given the naming prompt and the message as its last
  argument; `[]` turns naming off). Both come from the person's settings only, never from
  the project's `.herdr/settings.json`.
- Without `branchAgent`, the branch is named by `claude -p --model haiku` as before, and
  only when `agent` is `claude`.
- The message field reads "first message to the agent (optional)".

## What it expects from Herdr's original

- Only code added by `worktree-settings` and `new-worktree-dialog`: the `object` helper,
  the `branchPrefix` setting, the message `InputState`, the `exec("claude", …)` call in
  `suggest()`, `field()`, and `const agent = p.argv ?? (task ? ["claude"] : undefined);`
  in `create()`.

## How to check it works

- `"agent": ["codex"]`, New worktree with a message: the space runs `codex` with it, and no
  branch is suggested.
- `"branchAgent": ["codex", "exec"]`: typing a message suggests a branch from codex.
