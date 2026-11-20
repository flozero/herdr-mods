# gitlab-review

`./install-gitlab-review.sh` installs `gitlab-review` (the window) and `gitlab-review-open` (the launcher).

## What it does

Review GitLab merge requests in a Herdr window: your merge requests and the ones to review, the description, the diff (split or unified), threads, draft comments, approvals, and the team review rules that apply to the changed files.

- **Ask the agent** (`g`, `⌥↵` in the comment box) opens a read-only agent on the right that knows the merge request and answers your questions. Nothing is posted.
- **Local review**: on a branch without a merge request (or opened with `local`), comments on the code go to an agent working in the checkout (`a`), which changes the code.
- **Review rules**: with `rulesUrl`, the agent can review the merge request against the rules that match its files.

## Keys

| macOS | Linux | |
| --- | --- | --- |
| `cmd-shift-g` | `ctrl-alt-g` | open the window, on the merge request of the focused folder |
| `alt-enter` | `alt-enter` | ask the agent, in the window |
| `cmd-r` | `ctrl-r` | refresh, in the window |

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
