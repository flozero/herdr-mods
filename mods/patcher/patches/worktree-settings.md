# worktree-settings

New / Remove worktree read their settings from the person's `settings.json` and the
project's `.herdr/settings.json`: where the checkouts go, what runs in a new one, what runs
before one is removed, and whether removing it deletes its branch.

Made on top of: `sync-new-worktrees`.

## What it does

In `mods/worktree` → `my-worktree`:

- The person, `~/.config/herdr-app/settings.json`:

  ```json
  "worktrees": {
    "directory": "~/.herdr/worktrees",
    "setup": "sh ~/.herdr/worktree-setup.sh",
    "teardown": "",
    "deleteBranch": false,
    "repos": { "~/dev/my-repo": { "directory": ".claude/worktrees", "deleteBranch": true } }
  }
  ```

- The project, `<main checkout>/.herdr/settings.json` (commit it for everyone):
  `{ "worktrees": { "directory": ".claude/worktrees", "setup": "make venv", "teardown": "docker compose down", "deleteBranch": true } }`.
- `directory`: the project's file, else the person's `repos` entry for the main checkout,
  else `<worktrees.directory>/<repo>`. A relative path is relative to the main checkout.
  New worktree creates `<directory>/<branch slug>`, and its description names that folder.
- `setup`: the person's `worktrees.setup`, then the project's (else its `repos` entry's),
  run with `sh` in the new space's first terminal before the agent it was given. A failing
  step prints `herdr: setup step failed` and the rest still runs. They get
  `HERDR_WORKTREE_REPO`, `HERDR_WORKTREE_PATH` and `HERDR_WORKTREE_BRANCH`.
- `teardown`: the project's, then the person's, run in the checkout before Remove worktree
  closes its space. A failure keeps the checkout and says why; Enter again removes it
  without the teardown.
- `deleteBranch`: Remove worktree also deletes the branch (`git branch -D`) after
  `git worktree remove` succeeds. The dialog says "Deletes branch <name> too." and warns
  when the branch has commits on no other branch or remote. A branch that won't delete is a
  toast: the worktree is gone by then.
- A broken file or value is an error in the dialog; nothing is created or removed.
- Setup and teardown don't run on Windows (they need `sh`).

## What it expects from Herdr's original

`mods/worktree/main.js`:

- `root(userHome)` ends with `return path.replace(/\/+$/, "");` then `}`: the helpers go
  right after it. `readTextFile`, `appHome` and `exec` are imported; `notify` is imported on
  its own line as `notice`.
- `init()`: `const repo = await repoOf(this.folder, this.on);`, then the settings load
  (not for Open) and, for Remove with `deleteBranch`, the branch (`branchOf`).
- `work(cx)`: `this.busy = false;` then `if (!this.error) this.close();`, the branch
  deletion goes between them. `scripts()` and `deleteBranch()` go right before `work`.
- `create()`: ``const path = `${this.root}/${this.repo.name}/${slug(branch)}`;``, then after
  `git worktree add`: `const p = props();`, the "Leave spaces unnamed…" comment and
  `run("space.new", { folder: path, machine: this.on ?? "", tab: p.tab, argv: p.argv });`.
- `remove()`: `if (changed) return "It changed since this opened. Enter again removes it anyway.";`
  is followed by the `git worktree list` read and the refusal of a locked worktree
  (`if (lock) return lock === "locked" ? …;`). The teardown goes right after that, before the
  `if (s?.id) {` block that closes the space (Herdr 0.1.18), so before the space is closed.
- `render()`: the Remove text ending "The branch stays.", the New one starting
  "A new space on a checkout in ${tilde(this.root, this.userHome)}/${r.name}/.",
  `const blocked = …`, `.child(div().text_color(t.muted).child(detail))` and
  `.when(Boolean(this.error), …)`.

The same settings, with `.herdr/worktree.json` instead of `.herdr/settings.json`, are in
Herdr's PR #1194. If Herdr ships them, this patch shrinks to `deleteBranch`.

## How to check it works

- `"repos": { "~/dev/my-repo": { "directory": ".claude/worktrees" } }`, New worktree in my-repo:
  the dialog names `~/dev/my-repo/.claude/worktrees/`, the checkout lands there.
- `"setup": "echo hi"`: the new space's terminal prints `hi`, then the shell or the agent.
- `.herdr/settings.json` with `"teardown": "false"`: Remove worktree says "Teardown failed
  (exit 1)", Enter again removes it.
- `"deleteBranch": true`: Remove worktree says "Deletes branch <name> too." and
  `git branch --list <name>` is empty after.
- A stray comma in either file: the dialog shows the parse error.
