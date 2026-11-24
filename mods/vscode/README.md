# vscode

`./install-vscode.sh` installs `vscode` and `vscode-open` (the launcher).

> **Needs the Herdr fork with the webview: [flozero/herdr-app](https://github.com/flozero/herdr-app), branch `florentg/webview`.** Herdr's UI kit has no webview yet, so the mod fails to load on a stock Herdr.

## What it does

VS Code (code-server, downloaded on first use) in a pane beside the focused one, on its folder. The `herdr-review` extension comes with it: comment lines in files and diffs (`cmd-alt-c`), then send the review (`cmd-alt-enter`) to the agent working in the repository, or to a new one.

Popups, dialogs and Herdr windows (the picker, excalidraw…) hide the web view while they cover it: a native web view is always drawn above the rest of the window.

The web view uses `webview(url, { keep: true })`, so code-server isn't reloaded when you switch tabs. The fork's web view only loads `http` and `https` URLs.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-alt-e` | `cmd-alt-e`, or `ctrl-alt-shift-e` | open VS Code beside the focused pane |

From `keys/vscode.json` and `keys/vscode.linux.json`. While the web view has the keyboard, Herdr only keeps the keys listed in `webview_keys` in `~/.config/herdr-app/settings.json` (the fork's default: `cmd-q`, `cmd-shift-w`, `ctrl-tab`, `ctrl-shift-tab`). On macOS, `install-vscode.sh` adds `cmd-alt-e` and `cmd-e` (the code mod) to it, keeping your entries; if you bind another key to `mod.open:vscode-open`, add it there too.

## Config

`mods/vscode/config.json` (made from `config.example.json` on install, kept on update):

| Key | Default | |
| --- | --- | --- |
| `port` | `8765` | the port code-server listens on (change it when something else uses 8765) |
| `agent` | `["claude"]` | the agent the review starts when none works in the repository; the review is its last argument |
| `installRecommended` | `false` | also install the extensions a repository recommends in `.vscode/extensions.json` |
| `python` | none (the example: `${workspaceFolder}/venv/bin/python`) | the Python interpreter |
| `extensions` | none (the example lists some) | marketplace extensions to install |
| `settings` | none | VS Code settings, over the mod's own |

## Requirements

- The Herdr fork above.
- macOS, or Linux on X11 (`x86_64` or `arm64`): the mod downloads the code-server build for the machine (`macos-arm64`, `macos-amd64`, `linux-amd64` or `linux-arm64`). On Linux the web view is a WebKitGTK child of Herdr's X11 window, so start Herdr with `HERDR_APP_X11=1` to run its window on XWayland (`HERDR_APP_X11=1 herdr-app`; the fork keeps `WAYLAND_DISPLAY` for the terminals); on Wayland the pane stays empty. While the pointer is over the web view it has the keyboard, so Herdr's own shortcuts wait until the pointer leaves it. WebKitGTK 4.1 and GTK 3 must be installed (`webkit2gtk-4.1`, `gtk3` on Arch).
- `curl`, `tar`, `zip`; `cargo`, optional, builds the Python environment tool for `ms-python.python`.

## Security

- code-server listens on `127.0.0.1:8765` (the `port` config) with `--auth none`: any program running as any user on this machine can open it, and with it a shell as you. It reuses whatever already answers on that port.
- code-server `4.145.2` is downloaded over https from its GitHub release into `~/.cache/herdr-vscode`, to a temporary folder first; its checksum isn't checked.
- Workspace trust is off, so a repository's tasks and settings apply as soon as it opens. The extension's `herdrReview.agent` and `herdrReview.base` are application settings: a repository's `.vscode/settings.json` can't change them. A repository's recommended extensions are installed only with `installRecommended`.
