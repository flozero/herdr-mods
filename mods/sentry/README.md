# sentry

`./install-sentry.sh` installs `sentry` (the window), `sentry-current` and `sentry-open` (launchers).

## What it does

Sentry issues in a Herdr window, through Sentry's MCP server: your team's issues by period and sort, details, assign, ignore, resolve. **Work with the agent** (`c`) starts the configured agent on the issue, in a new tab of the `repo` space.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-s` | `cmd-s`, or `ctrl-shift-s` | the Sentry issue the focused terminal mentions (or the list) |
| `cmd-shift-s` | `cmd-shift-s`, or `ctrl-alt-s` | open the window |
| `cmd-r` | `cmd-r`, or `ctrl-r` | refresh, in the window |

From `keys/sentry.json` and `keys/sentry.linux.json`. The other keys are shown at the bottom of the window.

## Config

`mods/sentry/config.json` (made from `config.example.json` on install, kept on update):

| Key | Default | |
| --- | --- | --- |
| `org` | `""` | the organization slug |
| `team` | `""` | the team slug |
| `environment` | `""` | the environment to show, empty for all |
| `repo` | `""` | the repository the agent works in (`~/` allowed) |
| `agent` | `["claude"]` | the agent command; the task is its last argument |
| `agentName` | from `agent` (`claude` → `Claude`) | the name shown on buttons and messages |
| `skill` | `""` | an agent skill to run on Work with the agent, empty for none |

## Requirements

- `node`, for `cli/sentry-me.mjs`: the window talks to Sentry's MCP server (`https://mcp.sentry.dev`) with OAuth. The window asks to connect; `node ~/.config/herdr-app/mods/sentry/cli/sentry-me.mjs login` does it by hand. The tokens are kept in `~/.config/herdr-sentry/mcp.json` (folder `0700`, file `0600`).
- The agent CLI (`claude` by default), with the Sentry MCP server added if it should read Sentry itself.

## Security

Sentry issue titles come from the events your apps send, and anyone with a public DSN can send one: the title goes to the agent's first message, so a hostile one can try to steer it (prompt injection). The agent runs with its normal permissions.
