# herdr-mods

> # ⚠️ BETA: this changes a lot

Mods for the [Herdr app](https://herdr.dev).

## TL;DR

```sh
git clone https://github.com/flozero/herdr-mods.git
cd herdr-mods
./install-all.sh
```

Then, once: `cmd-alt-p` (`ctrl-alt-p` on Linux) and click **Use the my-main layout**. The worktree mods only work in that layout (see [worktree](mods/worktree-new/README.md)).

## Update

```sh
git pull && ./install-all.sh
```

Herdr loads the mods from `~/.config/herdr-app/mods/`, not from this repository, so a `git pull` alone changes nothing: the `install-*.sh` scripts copy them over. No restart is needed: Herdr reloads a mod as soon as its files change. A tab that looks stuck after an update (loading forever), close it and open it again. Your `config.json` files and keys are kept.

## How mods work

A mod is a folder with a `mod.json` and a `main.js` that Herdr runs as a panel, a tab or a window. Each `install-<group>.sh` copies the group's mods into `~/.config/herdr-app/mods/`, adds its keys to `~/.config/herdr-app/keys.json` (`keys/<group>.json` on macOS, `keys/<group>.linux.json` on Linux; a key you already use is kept, it tells you which), and checks it with `herdr-app check`. Herdr reloads a mod as soon as its files change, and an update keeps each mod's `config.json`. The small `*-open` folders are launchers: a key can only open a mod, so they find or create the right tab, then close.

## Mods

Each group installs alone (`./install-<group>.sh`) and has its README: what it does, its config, keys and requirements.

- [worktree](mods/worktree-new/README.md): Herdr's worktree dialog, patched: a first message to the agent, a suggested branch, setup and teardown. `cmd-shift-n` / `cmd-shift-o` (Linux `ctrl-alt-n` / `ctrl-alt-o`), only in the `my-main` layout.
- [linear](mods/linear/README.md): Linear issues, and Work with the agent on one. `cmd-i` / `cmd-shift-i` (Linux `ctrl-shift-i` / `ctrl-alt-i`).
- [gitlab-review](mods/gitlab-review/README.md): review GitLab merge requests with `glab`. `cmd-shift-g` (Linux `ctrl-alt-g`).
- [sentry](mods/sentry/README.md): Sentry issues through Sentry's MCP. `cmd-s` / `cmd-shift-s` (Linux `ctrl-shift-s` / `ctrl-alt-s`).
- [http](mods/http/README.md): an HTTP client. `cmd-shift-h` (Linux `ctrl-alt-h`).
- [excalidraw](mods/excalidraw/README.md): an Excalidraw canvas an agent can draw on. `cmd-shift-e` (Linux `ctrl-alt-e`).
- [code](mods/code/README.md): Herdr's own editor with language servers, the branch's changes and review comments for the agent, needs the Herdr fork with the editor language-server API. `cmd-e` (Linux `ctrl-shift-e`).
- [vscode](mods/vscode/README.md): VS Code in a pane, needs the Herdr fork with the webview. `cmd-alt-e` (Linux `ctrl-alt-shift-e`).

The agent is Claude by default; `agent` and `agentName` in a mod's `config.json` (in `settings.json` `worktrees` for the worktree mods) pick another.
