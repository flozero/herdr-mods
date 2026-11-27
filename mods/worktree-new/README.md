# worktree

`./install-worktree.sh` installs `patcher`, `worktree-sync`, `worktree-new` and `worktree-open`.

> **Use the `my-main` layout.** Everything below works only there. A mod runs only where a layout places it, and Herdr rewrites its own `main` layout at every start, so the patcher makes `my-main`: Herdr's `main` with the patched menus and sidebar, plus two hidden blocks that run the patcher and `worktree-sync`. Switch with **Use the my-main layout** in the patcher, the patcher's toast, or `cmd-shift-l` (`ctrl-shift-l` on Linux).

## What it does

- Herdr's own worktree dialog, menus and sidebar, with our changes kept as patches (`mods/patcher`, after Frédéric Morin's): in `my-main` they are applied again at every start on Herdr's current mods, a toast says it worked, and a release that breaks one is reported instead of lost. `mods/patcher/README.md` says how patches work and how to fix one.
- New worktree asks for a first message to the agent (several lines, `⌘↵` creates), the branch (suggested from the message), the space's name and **skills** in a sidebar: the ones in `~/.claude/skills` and the repo's `.claude/skills` whose name starts with the prefix typed above them (kept for next time, `workflow-` at first, several split by commas, empty for all). A click writes "Use the <name> skill." on its own line where the cursor is, so you arrange the message; `manual` marks a skill with `disable-model-invocation: true`. To offer another skill, write one with the prefix. A new branch starts from origin's default branch; with a message, the space starts the agent on it after the setup. Linear's Work with the agent opens the same dialog, filled in from the issue.
- Remove worktree runs the teardown, can delete the branch, and removes a locked worktree on a second Enter.
- A worktree made outside the dialog (git, an agent) gets its space in the background (`worktree-sync`).
- New space starts in the folder you are in.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-shift-n` | `cmd-shift-n`, or `ctrl-alt-n` | New worktree |
| `cmd-shift-o` | `cmd-shift-o`, or `ctrl-alt-o` | Open worktree |
| `cmd-alt-p` | `cmd-alt-p`, or `ctrl-alt-p` | Patcher: apply the patches again, show each one |

From `keys/worktree.json` and `keys/worktree.linux.json`.

## Config

In `~/.config/herdr-app/settings.json` (yours) and `<repo>/.herdr/settings.json` (the project's, committed; it wins for `directory`, `setup`, `teardown` and `deleteBranch`):

```json
"worktrees": {
  "directory": "~/.herdr/worktrees",
  "setup": "sh ~/.herdr/worktree-setup.sh",
  "teardown": "docker compose down",
  "deleteBranch": true,
  "branchPrefix": "me/",
  "agent": ["claude"],
  "branchAgent": ["claude", "-p", "--model", "haiku"],
  "repos": { "~/dev/my-repo": { "directory": ".claude/worktrees" } }
}
```

| Key | Default | |
| --- | --- | --- |
| `directory` | `~/.herdr/worktrees/<repo>` | where new checkouts go |
| `setup` / `teardown` | none | shell commands run after create / before remove |
| `deleteBranch` | `false` | remove also deletes the branch |
| `branchPrefix` | `""` | put in front of every new branch |
| `agent` | `["claude"]` | the command a first message starts (yours only) |
| `branchAgent` | Claude Haiku when `agent` is `claude`, none otherwise | the command that names the branch: it gets the naming prompt and the message as its last argument and prints the name; `[]` turns naming off (yours only) |

`agent` and `branchAgent` are read from your settings only, never from a project's `.herdr/settings.json`.

## Requirements

- `git`; the default branch naming needs the `claude` CLI.
- Herdr's own `worktree`, `menu`, `new-menu`, `spaces` and `tabs` mods (shipped with Herdr).

## Security

A project's `.herdr/settings.json` `setup` and `teardown` run through `/bin/sh` when you create or remove a worktree, like direnv: only use it in repositories you trust. Repo, path and branch reach the script as `$1`..`$3`, never pasted into it.
