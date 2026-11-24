---
name: workflow-build
description: Build an agreed ticket in its worktree - implement, check, have Florent review, describe, open the draft merge request and watch it
disable-model-invocation: true
argument-hint: "<Linear ID>"
---

# Build

You run in the ticket's worktree. Read `~/.herdr/workflows/<ID>.md` first: the summary and the decisions are there, don't ask again what was decided. Talk to Florent in French, short.

Go through these skills in order, reading each `~/.claude/skills/<name>/SKILL.md` and following it. Move on by yourself; stop only where a skill says to wait for Florent.

1. `workflow-implement`
2. `workflow-checks`
3. `workflow-review`: waits for Florent.
4. `workflow-describe`: waits for his agreement on the description.
5. `workflow-ship`
6. `workflow-watch-mr`

After each one, add one line to the memory file: what it did, and anything the next ones must know. When Florent says to go back to a step with a comment, add the comment to the memory file and start again from that step.
