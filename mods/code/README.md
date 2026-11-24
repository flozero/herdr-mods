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
| `ctrl-k` | comment the selected lines |
| `ctrl-enter` | send the review to the agent |
| `ctrl-shift-enter` | publish the review on the merge request |
| `ctrl-s` | save |
| `ctrl-w` | close the tab |
| `f12`, `cmd-click` | go to definition |
| `shift-f12`, `ctrl-click` or right click | show where it is used (click a line to go there, `Esc` closes) |
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
| `keys` | `{}` | `{ "<id>": "<key>" }`, the ids above (`files`, `search`, `find`, `sidebar`, `changes`, `comment`, `send`, `publish`, `save`, `close`, `definition`, `references`, `back`, `forward`, `nextTab`, `previousTab`, `shortcuts`) |
| `servers` | `{}` | language server commands, over the built-in ones |

## Requirements

- The Herdr fork above.
- `git`, `node` (the language-server bridge); `glab` or `gh` to publish on a merge request.
- Language servers are downloaded on first use into `~/.cache/herdr-code/servers`.

## Security

- A language server runs as you on the repository you open, through `lsp-bridge.mjs` on `127.0.0.1`, for one connection.
- Review comments go to the agent as its message, with its normal permissions.
