# linear

`./install-linear.sh` installs `linear` (the window), `linear-current` and `linear-open` (launchers).

## Setup

None. Open the window and click **Connect Linear**: your browser asks you to accept, and that's all. No API key, no OAuth app. Everything, reads and writes, goes through Linear's MCP server (`https://mcp.linear.app`) as you.

## What it does

Linear issues in a Herdr window: your issues, saved views and projects, comments, and edits to the title, description, status, assignee, priority, labels, project, cycle and due date. The issues the focused terminal mentions come first.

- **Home** (`cmd-shift-i`, `ctrl-alt-i` on Linux): two tabs, **Projects** and **Views** (`Tab` switches). Each shows its favorites, the ones you opened last, then all of them; the projects load their next page as you scroll. Type to find one by name. `⌃D` or the star makes it a favorite: the favorites are kept by the mod, not in Linear (the MCP server doesn't give Linear's). **My issues** lists your open issues across every team and project; `Esc` there comes back home. Lists load their next page as you scroll too.
- **In a project or a view**, the **People** menu shows only the issues of the people you check: you by default, uncheck yourself to see everyone, or check several people (or Unassigned). The choice is kept per project and view.

- **An issue** opens full width: the description, sub-issues and other relations, the activity, then the comments. On the right: **Open in Linear**, **Actions**, the properties, the labels and the project.
- **Title and description** are edited where they are, as in Linear: click one (or `e` for the description) and it becomes a field; leaving it saves (`Esc`, `⌘↵`, or a click elsewhere; `↵` in the title). An empty description shows "Add a description…".
- **Properties** are edited from the sidebar, as in Linear: click status (`s`), assignee (`⇧A`), priority (`p`), cycle (`⇧C`), due date (`⇧D`), or the **Labels** (`l`) and **Project** (`⇧P`) titles. Each opens a list to filter by typing; labels toggle and the list stays open. The due date takes a typed date (`2026-12-03`, `3/12`, `30`) or Today, Tomorrow, Friday, Next week, In two weeks.
- **Actions → Start a new worktree with agent** asks for the agent's first prompt, then starts it in a new worktree of the issue's repo (pick another repo with `⌃N`/`⌃P` or a click). The prompt comes first, then the issue. **Save as template** keeps the prompt under a name; templates are in `.cache/prompts.json` and shared by all issues.
- **Work with the agent** (`c`) starts the configured agent on the issue: in a new tab of an open space, in a repo, or in a new worktree (through the worktree mods' dialog when `worktreeMod` is set). Its first message is the issue, its description and recent comments, and the downloaded images.
- **New issue** (`n`, or `+` in the header) opens a form: team (`⌃T`), title, Markdown description, assigned to you (`⌃M`). The project, labels, priority and team come from where you are: the project tab, the view's team, and the project and labels every listed issue shares; click a chip to drop it. `⌘↵` creates it and opens it.
- **Ask the agent** (`k`, or `⌥↵` in the comment box) opens a read-only agent on the right to answer questions about the issue. Nothing is posted.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-i` | `cmd-i`, or `ctrl-shift-i` | the issue of the focused tab (or the list) |
| `cmd-shift-i` | `cmd-shift-i`, or `ctrl-alt-i` | open the window, on the home |
| `cmd-r` | `cmd-r`, or `ctrl-r` | refresh, in the window |

From `keys/linear.json` and `keys/linear.linux.json`. The other keys are in the shortcuts window: `ctrl-/`, or **Shortcuts** at the bottom right.

## Config

`mods/linear/config.json` (made from `config.example.json` on install, kept on update):

| Key | Default | |
| --- | --- | --- |
| `language` | `"en"` | `"en"` or `"ko"` |
| `agent` | `["claude"]` | the agent command; the task is its last argument |
| `agentName` | from `agent` (`claude` → `Claude`) | the name shown on buttons and messages |
| `agentAskArgs` | `null` | extra arguments for Ask; `null` with `claude` means `--permission-mode plan` plus a deny list of edits, commits, pushes and Linear writes, `null` with another agent means none |
| `skill` | `""` | an agent skill to run on Work with the agent (`Use the <skill> skill for Linear <ID>…`), empty for none |
| `refreshSeconds` | `120` | how often the lists refresh (each refresh is two `node` runs, one MCP session each) |
| `taskContext` | `true` | put the description, comments and images in the agent's first message |
| `terminalIssues` | `true` | show the issues the focused terminal mentions first |
| `nestSubIssues` | `true` | sub-issues under their parent |
| `cacheDays` | `30` | how long cached issues and images are kept |
| `worktreeMod` | `"my-worktree"` | the worktree dialog to open for a new worktree, `null` for plain `git worktree` |
| `worktreeRepo` | `""` | the repository to work in by default |
| `branchPrefix` | your GitLab username | the branch prefix (`<prefix>/<branch>`) |

## Requirements

- `node`, for `cli/linear-me.mjs`. Connect Linear runs `node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs login` (you can run it by hand too). The tokens are kept in `~/.config/herdr-linear/mcp.json` (folder `0700`, file `0600`) and refreshed on their own; `linear-me.mjs logout` forgets them.
- The agent CLI (`claude` by default). The Ask deny list names the `linear-me` MCP server's write tools; add that server to your agent to let it read Linear itself.
- `glab`, optional: the default branch prefix and merge request links.
- `curl` and `file`, for the images.

## What the MCP server doesn't give

Linear's public API (`api.linear.app/graphql`) refuses the MCP token, and has no sign-in without an OAuth app of your own, so the mod only uses what the MCP tools return. Left out or reduced:

- **Issue history**: only status changes (from the issue's state history), without who made them. Assignee, label, priority, title, project, cycle and due date changes aren't shown.
- **Project activity**: no history events; project updates and comments are shown.
- **Project progress**: the progress bar is hidden.
- **Favorite projects**: Linear's favorites aren't in the MCP tools, so the home keeps its own.
- **Merge request status**: Linear's MR metadata (draft, review, conflicts) isn't there; an issue's MR shows as merged when the issue is completed, closed when it's canceled, open otherwise. It appears once the issue was opened.
- **Reactions** on issues and comments, **sub-issue order**, **status colors** (taken from the status type) and **cycle numbers**.
- **Your email** isn't needed anymore (`email` is ignored): the MCP knows who you are.

## Security

- No API key: the sign-in is OAuth with PKCE against Linear's MCP server, on `127.0.0.1` only, and the answer must carry the sign-in's `state`. `linear-me.mjs batch`, used for every read, takes only read tools (`get_*`, `list_*`, `whoami`).
- Issue text and comments are written by other people and go to the agent as its first message: a hostile issue can try to steer it (prompt injection). Work with the agent runs with your agent's normal permissions; Ask runs Claude in plan mode with a deny list, which narrows what it can do but is no sandbox.
- Images are fetched over https only (`--proto =https`), at most 20 MB each, and kept under hashed names.
