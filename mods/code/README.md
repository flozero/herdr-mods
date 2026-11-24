# code

`./install-code.sh` installs `code` (the editor) and `code-open` (the launcher).

> **Needs the Herdr fork with the editor language-server API: [flozero/herdr-app](https://github.com/flozero/herdr-app), branch `florentg/editor-lsp-api`.** On a stock Herdr the editor opens without completion, hover, definitions, diagnostics or highlights.

## What it does

Herdr's own editor in a tab, on the focused pane's repository: a file tree (drag its edge to resize it), a file finder, language servers (completion, hover, go to definition, diagnostics), and the branch's changes against its base. A changed file opens as its diff: the whole file with its line numbers and its deleted lines (`−`, on red) between the others, added lines on green. Edit it as any file; deleted lines can't be edited. gitlab-review's Herdr editor (`e`) opens it on a merge request's worktree, in the changes view.

In the changes, **Uncommitted** shows only what isn't committed yet (against `HEAD`), **All** the whole branch against its base.

**Graph** shows the history (`git log --graph`, the branch and its base); click a commit to see its diff, click one of its files to open it, `Esc` goes back to the editor.

**Search** finds text in the repository's files with `git grep`, so what `.gitignore` ignores is left out (untracked files are in). Replace the selected match (`Replace`, or `⏎` in the replace field), skip it (`Skip`), or replace them all (`Replace all`).

Search has two tabs. **Text** is the search above. **Symbol** works through the language servers: it takes the symbol under the cursor (`At cursor` takes it again) and lists its real uses, not the same word in a string or another scope; `Rename` renames all of them. Type another name to find a symbol of the project, and click one to use it. A file that had no unsaved edits is saved after its replacement; one that had keeps them unsaved.

Files changed on disk (by an agent, say) reload in the editor when they have no unsaved edits, and the changes refresh.

A Markdown file (`.md`, `.markdown`, `.mdx`) has a **◧ preview** button beside **⧉ copy** (or `ctrl-shift-v`): the rendered file opens at the right of the editor and follows what you type, unsaved edits included, and where you scroll: the line at the top of the editor is at the top of the preview (that needs the fork's `first_visible_line` and `scroll_to_line`; on a stock Herdr the preview scrolls on its own). A launcher can open it that way with `props` `{ "path": …, "line": …, "preview": true }`. Web links open in the browser, links to other files of the repository in the editor. Each tab keeps its own preview open or closed.

Select lines and comment them; send the comments to the agent working in the repository (or a new one), or publish them on the merge request.

## Keys

`cmd-e` (on Linux too, or `ctrl-alt-c`) opens it, from `keys/code.json` and `keys/code.linux.json`. In the editor:

| Key | |
| --- | --- |
| `ctrl-p` | find a file |
| `cmd-shift-f`, `ctrl-shift-f` | find and replace in the project (Search) |
| `cmd-f`, `ctrl-f` | find in the file (`⏎` next, `⇧⏎` previous, `Esc` close) |
| `ctrl-b` | show or hide the sidebar |
| `ctrl-shift-g` | switch between files and changes |
| `ctrl-shift-v` | show or hide the Markdown preview (a `.md` file) |
| `ctrl-k` | comment the selected lines |
| `ctrl-enter` | send the review to the agent |
| `ctrl-shift-enter` | publish the review on the merge request |
| `ctrl-s` | save |
| `ctrl-w`, middle click on a tab | close the tab (a tab with unsaved changes asks for a second one) |
| `f12`, `cmd-click` | go to definition |
| `shift-f12`, right click, `ctrl-click` (macOS), `ctrl-cmd-click` (ctrl + Super + click on Linux, where Super alone moves the window on Omarchy and `ctrl-click` is go to definition) | show where it is used (click a line to go there, `Esc` closes) |
| `ctrl--` | go back to the previous file or place |
| `ctrl-=`, `ctrl-+` | go forward again |
| `ctrl-alt-down`, `ctrl-alt-up` | next, previous change in the file |
| `ctrl-alt-m` | show or hide the MR comments in the code (`ctrl-k` on one replies) |
| `ctrl-alt-r`, `ctrl-alt-h` | resolve or reopen, hide or show the MR thread under the cursor (resolved ones start hidden) |
| `ctrl-alt-right`, `ctrl-alt-left` | next, previous tab |
| `ctrl-/` | show the shortcuts |

`keys` in the config changes them.

## Config

`mods/code/config.json` (made from `config.example.json` on install, kept on update):

| Key | Default | |
| --- | --- | --- |
| `agent` | `["claude"]` | the agent the review starts when none works in the repository |
| `agentName` | `"Claude"` | the name shown on messages |
| `keys` | `{}` | `{ "<id>": "<key>" }`, the ids above (`files`, `search`, `find`, `sidebar`, `changes`, `preview`, `comment`, `send`, `publish`, `save`, `close`, `definition`, `references`, `back`, `forward`, `nextTab`, `previousTab`, `shortcuts`) |
| `servers` | `{}` | language server commands, over the built-in ones, by name: `python`, `rust`, `go`, `opentofu`, `typescript`, `vue`, `bash`, `dockerfile`, `compose`, `postgres` |

## Requirements

- The Herdr fork above.
- `git`, `node` (the language-server bridge); `glab` or `gh` to publish on a merge request.
- Language servers are downloaded on first use into `~/.cache/herdr-code/servers`.
- Docker: `Dockerfile`, `Dockerfile.*`, `*.Dockerfile` and `Containerfile` get completion, hover and diagnostics from `docker-langserver`; Compose files (`compose.y[a]ml`, `docker-compose*.y[a]ml`, `compose.override.yml`, …) from `docker-compose-langserver`, which needs Node 22 or later. The Compose server completes with snippets; the editor has none, so a snippet is inserted as text (its placeholders stay, to be typed over) and indented to the line it lands on. They are installed with the other npm servers the first time such a file opens; a `servers` entry (`dockerfile`, `compose`) runs your own instead.
- SQL: `.sql` files go to [postgres-language-server](https://github.com/supabase-community/postgres-language-server) (Supabase's community project, built on PostgreSQL's own parser), so it is PostgreSQL only. With nothing configured you get syntax errors. For completion of tables, columns and functions (aliases included), hover and errors on names that don't exist, it needs a database: put a `postgres-language-server.jsonc` at the root of the repository (`npx @postgres-language-server/cli init` writes one) and set its `db` (`host`, `port`, `username`, `password`, `database`). Without that file it connects to nothing. The server's migration lints (lock timeouts, several `ALTER TABLE`) are off unless that file turns them on (`"linter": { "enabled": true }`): they warn on every statement of a generated migration. The mod gives it `postgres/postgres-language-server.jsonc` when the repository has none; a file of yours replaces it.

## Security

- A language server runs as you on the repository you open, through `lsp-bridge.mjs` on `127.0.0.1`, for one connection.
- The SQL server connects to the database named in the repository's `postgres-language-server.jsonc`, with the credentials in it: it reads the schema and checks statements against it. Keep that file to a development database (and out of git if it holds a password).
- Review comments go to the agent as its message, with its normal permissions.
