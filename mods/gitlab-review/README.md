# gitlab-review

`./install-gitlab-review.sh` installs `gitlab-review` (the window) and `gitlab-review-open` (the launcher).

## What it does

Review GitLab merge requests in a Herdr window: a person picker at the top of the list (you by default, `p` for someone else) with four filters on that person: to review, authored, recent merged and ignored (`1`–`4`), the description, the diff (split or unified), threads, draft comments, approvals.

- **Ask the agent** (`g`, `⌥↵` in the comment box) opens a read-only agent on the right that knows the merge request and answers your questions. Nothing is posted.
- **On the merge request**: edit the title (click it), the description and labels; resolve threads; apply a reviewer's suggestion (`Suggest a change` in the comment box writes one); edit or delete your comments; reactions; re-request a review; mark files viewed (`v`, kept on this computer, reset when the file's diff changes). When the branch is behind its target, ask the agent to rebase it.
- **Actions** (the `Actions ▾` button in the sidebar): mark as ready or draft, open in the browser or an editor, ignore, search, reload.
- **The comment box**: `Add to review` (`⌘↵`) keeps the comment pending; `Send to ▾` sends the review to the agent or to GitLab; `Review ▾` approves or requests changes (with the pending comments and the text, if any), closes, closes with the text as a comment, reopens, or discards the pending comments.
- **Local review**: on a branch without a merge request (or opened with `local`), comments on the code go to an agent working in the checkout (`a`), which changes the code.
- **Review rules**: with `rulesUrl`, the agent you ask (`g`) knows the rules that match the merge request's files.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-shift-g` | `cmd-shift-g`, or `ctrl-alt-g` | open the window, on the merge request of the focused folder |
| `alt-enter` | `alt-enter` | ask the agent, in the window |
| `cmd-r` | `cmd-r`, or `ctrl-r` | refresh, in the window |

From `keys/gitlab-review.json` and `keys/gitlab-review.linux.json`. The other keys are shown at the bottom of the window.

## Config

`mods/gitlab-review/config.json` (made from `config.example.json` on install, kept on update):

| Key | Default | |
| --- | --- | --- |
| `rulesUrl` | `""` | optional, `https://` only: a URL that answers `{ "rule_sets": [{ "page_title", "page_url", "mode", "globs", "body" }] }` |
| `agent` | `["claude"]` | the agent command; the first message is its last argument |
| `agentName` | from `agent` (`claude` → `Claude`) | the name shown on buttons and messages |
| `agentAskArgs` | `null` | extra arguments for Ask; `null` with `claude` means `--permission-mode plan` plus a deny list of edits, checkouts, commits, pushes and `glab` writes, `null` with another agent means none |

## Requirements

- `glab`, logged in (`glab auth login`) on the GitLab instance of the repository.
- `git`.
- The agent CLI (`claude` by default).

## Security

- Merge request titles, descriptions and comments are written by other people and go to the agent: a hostile one can try to steer it (prompt injection). Ask runs Claude in plan mode with a deny list, which narrows what it can do but is no sandbox; the local review agent runs with your agent's normal permissions.
- Branch names that aren't plain (`[A-Za-z0-9_./-]`) are left out of the commands suggested to the agent.
- Links from merge requests and rules open only when they are `http(s)`.
- The review rules (`rulesUrl`) go into the agent's prompt as they are: point it only at a source you trust.
- Opening a merge request in an editor runs the repository's `.herdr/settings.json` worktree `setup` (see the worktree README).
