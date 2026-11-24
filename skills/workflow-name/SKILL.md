---
name: workflow-name
description: Agree on a Linear ticket and a branch, create both, the worktree and the memory file, then start the build in a new Herdr space
disable-model-invocation: true
---

# Ticket, branch and space

Talk to Florent in French, short. You need the agreed summary from `workflow-grill`.

1. Suggest a Linear ticket title (short, says what needs doing) and a branch name `<prefix>/<ticket-id-lowercase>-<few-words>` (the prefix is `worktrees.branchPrefix` in `~/.config/herdr-app/settings.json`, else `glab api user`'s username). Ask for the team if it isn't obvious. Agree on both. When a ticket was given, keep it and only agree on the branch.
2. Create the ticket, or update the given one, with his Linear account: `node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs call save_issue - <<'JSON'` with `team`, `title`, a `description` from the summary (Context, Expected result, Plan, Out of scope), `assignee: "me"`, `state: "In Development"`. Long text always on stdin.
3. Create the branch in its own worktree from the default branch, up to date: `git fetch origin`, then `git worktree add -b <branch> <dir> origin/<default>`. `<dir>` is `<repo>/.claude/worktrees/<branch with / as ->` when `<repo>/.claude/worktrees` exists, else `~/.herdr/worktrees/<repo name>/<same>`. Run the worktree setup when one is configured (`worktrees.setup` in `~/.config/herdr-app/settings.json`, run in the worktree).
4. Write the memory file `~/.herdr/workflows/<ID>.md`: the ticket id and link, the repository, the branch, the worktree, the schema's name, the summary and the decisions. Every later skill reads it first and adds what the next ones must know.
5. Start the build in the worktree's space. The `worktree-sync` mod opens one by itself for every new worktree, within a few seconds: never make a second one.
   - Find it: poll `hc ls --json` (every second, up to 15 seconds) for a terminal whose `cwd` is the worktree, then read its space from `hc get <address> --json` (the `herdr.space` label).
   - Name it: `herdr-app do space.rename '{"id":"<space>","name":"<ID> <few words>"}'`.
   - Start the agent in that terminal: `hc send <address> "claude '/workflow-build <ID>'"`.
   - Only when no terminal shows up in time (the mod isn't installed), make the space yourself:

```sh
herdr-app do space.new --name "<ID> <few words>" --folder "<worktree>" --argv '["claude"]' --task "/workflow-build <ID>" --focus false
```

6. Tell Florent the ticket link, the branch, and that the build runs in the space `<ID> <few words>`.
