# excalidraw

`./install-excalidraw.sh` installs `excalidraw`.

## What it does

An Excalidraw canvas beside the terminal. Drawings are kept per project in `~/.herdr/drawings/<project>/`, the project being the repository (its worktrees share it) or the current folder. An MCP server lets an agent draw on it while you watch, and read what you changed.

Add the MCP server to your agent, for Claude:

```sh
claude mcp add -s user excalidraw -- node ~/.config/herdr-app/mods/excalidraw/mcp/server.mjs
```

It runs over stdio (no network port) and has six tools: `open_canvas`, `read_canvas`, `draw`, `update_shape`, `delete_shapes`, `clear_canvas`.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-shift-e` | `ctrl-alt-e` | open the canvas |

From `keys/excalidraw.json` and `keys/excalidraw.linux.json`.

## Config

None.

## Requirements

`node`, for the MCP server.

## Security

- A drawing `name` and `project` stay inside `~/.herdr/drawings/` (only letters, digits, `.`, `_`, `-` and spaces, no leading dot).
- `open_canvas` also takes a `path`: the agent can open and overwrite any `.excalidraw` file you can.
