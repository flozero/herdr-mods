# http

`./install-http.sh` installs `http` (the window) and `http-open` (the launcher).

## What it does

An HTTP client in a Herdr window: method, URL, query, headers and body, the response with its headers, status and timing, a history, and saved requests grouped by project. Copy any request as a `curl` command.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-shift-h` | `ctrl-alt-h` | open the window |
| `cmd-enter` | `ctrl-enter` | send, in the window |
| `cmd-shift-c` | `ctrl-shift-c` | copy as curl, in the window |

The open key comes from `keys/http.json` and `keys/http.linux.json`.

## Config

None.

## Requirements

`curl`.

## Security

- Requests run with `curl -q` (no `~/.curlrc`), `http` and `https` only, redirects included; headers and body go through temporary files, the URL after `--`.
- Saved requests (`~/.herdr/http`) and the history (`mods/http/.cache`) keep their headers, `Authorization` included, in plain text, in folders only you can read (`0700`).
