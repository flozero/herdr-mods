# herdr-mods

> # ⚠️ BETA: this changes a lot

Mods for the [Herdr app](https://herdr.dev).

## TL;DR

```sh
git clone https://github.com/flozero/herdr-mods.git
cd herdr-mods
./install-all.sh
```

Then, once: `cmd-alt-p` (`ctrl-alt-p` on Linux) and click **Use the my-main layout**. The worktree mods only work in that layout (see worktree below).

## Update

```sh
git pull && ./install-all.sh
```

Herdr loads the mods from `~/.config/herdr-app/mods/`, not from this repository, so a `git pull` alone changes nothing: the `install-*.sh` scripts copy them over. No restart is needed: Herdr reloads a mod as soon as its files change. A tab that looks stuck after an update (loading forever), close it and open it again. Your `config.json` files and keys are kept.

## How mods work

A mod is a folder with a `mod.json` and a `main.js` that Herdr runs as a panel, a tab or a window. Each `install-<group>.sh` copies the group's mods into `~/.config/herdr-app/mods/`, adds its keys to `~/.config/herdr-app/keys.json` (`keys/<group>.json` on macOS, `keys/<group>.linux.json` on Linux; a key you already use is kept, it tells you which), and checks it with `herdr-app check`. Herdr reloads a mod as soon as its files change, and an update keeps each mod's `config.json`. The small `*-open` folders are launchers: a key can only open a mod, so they find or create the right tab, then close.

## Mods

### worktree · `cmd-shift-n` new, `cmd-shift-o` open (Linux: `ctrl-alt-n`, `ctrl-alt-o`)

> **Use the `my-main` layout.** Everything below works only there. A mod runs only where a layout places it, and Herdr rewrites its own `main` layout at every start, so the patcher makes `my-main`: Herdr's `main` with the patched menus and sidebar, plus two hidden blocks that run the patcher and `worktree-sync`. In `main` or another layout, the patches aren't applied at start, the menus open Herdr's original dialog and new worktrees get no space. Switch with **Use the my-main layout** in the patcher (`cmd-alt-p`, `ctrl-alt-p` on Linux), the patcher's toast, or `cmd-shift-l` (`ctrl-shift-l` on Linux).

- Herdr's own worktree dialog, menus and sidebar, with our changes kept as patches (`mods/patcher`, after Frédéric Morin's): in `my-main` they are applied again at every start on Herdr's current mods, a toast says it worked, and a release that breaks one is reported instead of lost. Herdr's menus (right-click a space, the + in the tab bar) open the patched dialog too.
- New worktree asks for a first message to Claude, the branch (suggested from the message by Claude Haiku) and the space's name. A new branch starts from origin's default branch; with a message, the space starts Claude on it after the setup. Linear's Work with Claude goes through the same dialog.
- Remove worktree runs the teardown, can delete the branch, and removes a locked worktree on a second Enter.
- A worktree made outside the dialog (git, an agent) gets its space in the background (`worktree-sync`).
- New space starts in the folder you are in.

Config, in `~/.config/herdr-app/settings.json` (yours) and `<repo>/.herdr/settings.json` (the project's, committed; it wins):

```json
"worktrees": {
  "directory": "~/.herdr/worktrees",
  "setup": "sh ~/.herdr/worktree-setup.sh",
  "teardown": "docker compose down",
  "deleteBranch": true,
  "branchPrefix": "me/",
  "repos": { "~/dev/my-repo": { "directory": ".claude/worktrees" } }
}
```

`cmd-alt-p` (`ctrl-alt-p` on Linux, or `herdr-app do mod.open --name patcher`) applies the patches again and shows each one. `mods/patcher/README.md` says how patches work and how to fix one after a Herdr update.

### linear · `cmd-i` current issue, `cmd-shift-i` open

Linear issues, search, presets, and Work with Claude. Put a personal API key (Linear, Settings, Security & access, Personal API keys) in `"apiKey"` of `mods/linear/config.json`. `"skill"` names a Claude skill to run on Work with Claude, empty for none.

### gitlab-review · `cmd-shift-g`

Review GitLab merge requests (uses `glab`). `"rulesUrl"` in `mods/gitlab-review/config.json` is optional: a URL that answers `{ "rule_sets": [{ "page_title", "page_url", "mode", "globs", "body" }] }`, the team review rules matched on the changed files.

### sentry · `cmd-s` current issue, `cmd-shift-s` open

Sentry issues through the Sentry MCP. Set `"org"`, `"team"`, `"environment"` and `"repo"` in `mods/sentry/config.json`.

### http · `cmd-shift-h`

An HTTP client in a Herdr tab.

### excalidraw · `cmd-shift-e`

An Excalidraw canvas beside the terminal, with an MCP server so Claude can draw on it:

```sh
claude mcp add -s user excalidraw -- node ~/.config/herdr-app/mods/excalidraw/mcp/server.mjs
```

### vscode · `cmd-e`

> **Needs the Herdr fork with the webview: [flozero/herdr-app](https://github.com/flozero/herdr-app), branch `webview`.** Herdr's UI kit has no webview yet, so the mod fails to load on a stock Herdr.

VS Code (code-server, downloaded on first use) in a Herdr tab, on the current folder. `mods/vscode/config.json` lists the extensions and settings to install.
