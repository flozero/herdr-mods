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

## Linux and Omarchy

On Linux `cmd` is the Super key (the Windows key, or the Command key of an Apple keyboard): every `cmd-…` key of these mods works the same as on macOS, as long as nothing else has taken it. Each also has a Ctrl twin (the "Linux" keys below), bound next to it in `keys/<group>.linux.json`, for a desktop that keeps Super for itself; macOS gets the twins too, so the same fingers work on both.

Omarchy (Hyprland) takes many Super chords before Herdr sees them. `./omarchy/install.sh` is an optional step that frees the ones Herdr and its mods use, in `~/.config/hypr/bindings.lua`, between two marker lines (the full list, with what each chord did, is in `omarchy/bindings.lua`). It keeps a backup next to the file, reloads Hyprland and puts the backup back if Hyprland reports an error; run it again to update the block, and `./omarchy/install.sh --remove` takes it out. `install-all.sh` doesn't run it: it changes your Omarchy shortcuts.

It frees: Full screen, Switch input language (both), Toggle scratchpad, Calendar, Email, File manager, Signal, Editor, Obsidian, Google Maps, Toggle floating, Pseudo window, Docker, Omawrite, Browser on `Super + Shift + Return` (`Super + Shift + B` still opens it), the window-group moves on `Super + Alt + arrows`, and the webcam overlay size. The workspaces stay on `Super + 1..9, 0` (Herdr's tabs are `cmd-shift-[` / `]`, as on macOS, not `cmd-1..9`). `Super + Return` (the terminal) stays, so sending a comment, a request or a description is `ctrl-enter` on Linux (the hints say `⌃↵`). `Super + C / V / X / A` are Omarchy's universal clipboard: Herdr gets them as `ctrl-…`, which is why `cmd-c` and `cmd-v` work.

### Herdr's own shortcuts

`./install-herdr.sh` (Linux only, `install-all.sh` runs it) gives Herdr the macOS keymap, with cmd = Super, from `keys/herdr.linux.json`: `cmd-d` / `cmd-shift-d` split right / down, `cmd-t` new tab (`ctrl-shift-w` closes one: `Super + W` is Omarchy's close window, as is `Super + Q`), `ctrl-1..9` a space (it moves Linux's own `ctrl-1..9` from tabs to spaces, unless you changed them), `cmd-n` new space, `cmd-shift-[` / `]` previous / next tab, `cmd-alt-[` / `]` previous / next space, `cmd-[` / `]` previous / next agent, `cmd-alt-arrows` go to a pane, `cmd-shift-enter` zoom the pane, `cmd-shift-w` close it, `cmd-p` the picker, `cmd-b` the sidebar, `cmd-shift-l` the layout, `cmd-f` search in a terminal. Linux's own keys keep working next to them.

Left to the Linux keys, because Linux has one that everyone knows or because Omarchy needs the chord: zoom (`ctrl-=`, `ctrl--`, `ctrl-0`), settings and help (`ctrl-,`, `ctrl-?`), the palette (`ctrl-shift-p`), `cmd-q` (`Super + Q` closes the window) and `cmd-m` (Omarchy minimizes).

## Update

```sh
git pull && ./install-all.sh
```

Herdr loads the mods from `~/.config/herdr-app/mods/`, not from this repository, so a `git pull` alone changes nothing: the `install-*.sh` scripts copy them over. No restart is needed: Herdr reloads a mod as soon as its files change. A tab that looks stuck after an update (loading forever), close it and open it again. Your `config.json` files and keys are kept.

## How mods work

A mod is a folder with a `mod.json` and a `main.js` that Herdr runs as a panel, a tab or a window. Each `install-<group>.sh` copies the group's mods into `~/.config/herdr-app/mods/`, adds its keys to `~/.config/herdr-app/keys.json` (`keys/<group>.linux.json`, and `keys/<group>.json` too on macOS; a key you already use is kept, it tells you which), and checks it with `herdr-app check`. Herdr reloads a mod as soon as its files change, and an update keeps each mod's `config.json`. The small `*-open` folders are launchers: a key can only open a mod, so they find or create the right tab, then close.

## Mods

Each group installs alone (`./install-<group>.sh`) and has its README: what it does, its config, keys and requirements.

- [worktree](mods/worktree-new/README.md): Herdr's worktree dialog, patched: a first message to the agent, a suggested branch, setup and teardown. `cmd-shift-n` / `cmd-shift-o` (Linux `ctrl-alt-n` / `ctrl-alt-o`), only in the `my-main` layout.
- [linear](mods/linear/README.md): Linear issues, and Work with the agent on one. `cmd-i` / `cmd-shift-i` (Linux `ctrl-shift-i` / `ctrl-alt-i`).
- [gitlab-review](mods/gitlab-review/README.md): review GitLab merge requests with `glab`. `cmd-shift-g` (Linux `ctrl-alt-g`).
- [sentry](mods/sentry/README.md): Sentry issues through Sentry's MCP. `cmd-s` / `cmd-shift-s` (Linux `ctrl-shift-s` / `ctrl-alt-s`).
- [http](mods/http/README.md): an HTTP client. `cmd-shift-h` (Linux `ctrl-alt-h`).
- [excalidraw](mods/excalidraw/README.md): an Excalidraw canvas an agent can draw on. `cmd-shift-e` (Linux `ctrl-alt-e`).
- [code](mods/code/README.md): Herdr's own editor with language servers, the branch's changes and review comments for the agent, needs the Herdr fork with the editor language-server API. `cmd-e` (Linux `ctrl-alt-c`).
- [vscode](mods/vscode/README.md): VS Code in a pane, needs the Herdr fork with the webview. `cmd-alt-e` (Linux `ctrl-alt-shift-e`).

The agent is Claude by default; `agent` and `agentName` in a mod's `config.json` (in `settings.json` `worktrees` for the worktree mods) pick another.
