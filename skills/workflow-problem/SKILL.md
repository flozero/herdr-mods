---
name: workflow-problem
description: Florent has a problem to solve - understand it with him, agree on a ticket and a branch, then hand the build to a new agent in its own space
disable-model-invocation: true
argument-hint: "The problem, a Linear ticket, or nothing"
---

# I have a problem to solve

Talk to Florent in French, short. You start in the repository's main checkout: read it, never edit it.

1. Read `~/.claude/skills/workflow-grill/SKILL.md` and follow it until Florent agrees on the summary. When the argument is a Linear ticket, read it first (`node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs call get_issue '{"id":"<ID>"}'` and `list_comments`) and start from what it says.
2. Read `~/.claude/skills/workflow-name/SKILL.md` and follow it: it creates the ticket (or takes the given one), the branch, the worktree and the memory file, then starts `/workflow-build <ID>` in a new space.
3. Tell Florent the build goes on in that space, and that you are done here.
