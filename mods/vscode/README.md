# vscode

`./install-vscode.sh` installs `vscode` and `vscode-open` (the launcher).

> **Needs the Herdr fork with the webview: [flozero/herdr-app](https://github.com/flozero/herdr-app), branch `webview`.** Herdr's UI kit has no webview yet, so the mod fails to load on a stock Herdr.

## What it does

VS Code (code-server, downloaded on first use) in a pane beside the focused one, on its folder. The `herdr-review` extension comes with it: comment lines in files and diffs (`cmd-alt-c`), then send the review (`cmd-alt-enter`) to the agent working in the repository, or to a new one.

The web view uses `webview(url, { keep: true })`, so code-server isn't reloaded when you switch tabs. The fork's web view only loads `http` and `https` URLs.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-e` | `ctrl-shift-e` | open VS Code beside the focused pane |

From `keys/vscode.json` and `keys/vscode.linux.json`. While the web view has the keyboard, Herdr only keeps the keys listed in `webview_keys` in `~/.config/herdr-app/settings.json` (the fork's default: `cmd-q`, `cmd-shift-w`, `ctrl-tab`, `ctrl-shift-tab`). On macOS, `install-vscode.sh` adds `cmd-e` to it, keeping your entries; if you bind another key to `mod.open:vscode-open`, add it there too.

## Config

`mods/vscode/config.json` (made from `config.example.json` on install, kept on update):

| Key | Default | |
| --- | --- | --- |
| `agent` | `["claude"]` | the agent the review starts when none works in the repository; the review is its last argument |
| `installRecommended` | `false` | also install the extensions a repository recommends in `.vscode/extensions.json` |
| `python` | none (the example: `${workspaceFolder}/venv/bin/python`) | the Python interpreter |
| `extensions` | none (the example lists some) | marketplace extensions to install |
| `settings` | none | VS Code settings, over the mod's own |

## Requirements

- The Herdr fork above.
- macOS on Apple silicon (the code-server build it downloads is `macos-arm64`).
- `curl`, `tar`, `zip`; `cargo`, optional, builds the Python environment tool for `ms-python.python`.

## Security

- code-server listens on `127.0.0.1:8765` with `--auth none`: any program running as any user on this Mac can open it, and with it a shell as you. It reuses whatever already answers on that port.
- code-server `4.145.2` is downloaded over https from its GitHub release into `~/.cache/herdr-vscode`, to a temporary folder first; its checksum isn't checked.
- Workspace trust is off, so a repository's tasks and settings apply as soon as it opens. The extension's `herdrReview.agent` and `herdrReview.base` are application settings: a repository's `.vscode/settings.json` can't change them. A repository's recommended extensions are installed only with `installRecommended`.
