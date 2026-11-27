# http

`./install-http.sh` installs `http` (the pane) and `http-open` (the launcher).

## What it does

An HTTP client in a pane beside your terminal: method, URL, query, headers and a body (None, JSON, Text, XML, Form urlencoded, Multipart), the response with its headers, status and timing, and saved requests grouped by project. Copy any request as a `curl` command.

### Variables

`{{name}}` in the URL, params, headers, body or form fields is a variable. The **Vars** tab of a request sets variables from its response, for the requests after it:

| Variable | From the response |
| --- | --- |
| `token` | `body.data.token` |
| `userId` | `body.items[0].id` |
| `next` | `header.Location` |

Also `body` (all of it), `status` and `$.data.token`. The sidebar's **Variables** list shows them for the open project (unsaved requests have their own), and you can type one yourself there, a `{{base}}` URL for example. They are kept in `mods/http/.cache/vars/`, not with the requests; **Clear** empties them. A request with a variable that has no value isn't sent.

### The agent writes requests, you send them

An MCP server lets an agent create requests for you to run. Add it to your agent, for Claude:

```sh
claude mcp add -s user herdr-http -- node ~/.config/herdr-app/mods/http/mcp/server.mjs
```

It runs over stdio and has five tools: `list_requests`, `read_request`, `save_request`, `delete_request` and `open_request`, which shows a request in the HTTP pane beside the agent (it opens one if needed). None of them sends a request, and none reads your variables' values. The project defaults to the repository's name.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-shift-h` | `cmd-shift-h`, or `ctrl-alt-h` | open the pane on the right, or go to it if it's open in this tab |
| `cmd-enter` | `ctrl-enter` | send, in the pane |
| `cmd-shift-c` | `cmd-shift-c`, or `ctrl-shift-c` | copy as curl, variables filled in |

The open key comes from `keys/http.json` and `keys/http.linux.json`.

## Config

None.

## Requirements

`curl`, and `node` for the MCP server.

## Security

- Requests run with `curl -q` (no `~/.curlrc`), `http` and `https` only, redirects included; headers and body go through temporary files, the URL after `--`, multipart text fields with `--form-string`.
- A multipart value starting with `@` uploads that file. A request the agent wrote can name any file you can read: look at its Body before you send it.
- Saved requests (`~/.herdr/http`) and variables (`mods/http/.cache`) are plain text, `Authorization` and tokens included, in folders only you can read (`0700`).
