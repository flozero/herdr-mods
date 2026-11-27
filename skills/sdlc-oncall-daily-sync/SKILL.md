---
name: sdlc-oncall-daily-sync
description: Each morning of an on-call week: the day before's incidents summed up on the parent, and an agent offered for each one not Released yet.
disable-model-invocation: true
argument-hint: "<PARENT>"
---

# Daily sync

Conventions: `~/.claude/skills/sdlc-conventions/SKILL.md`.

1. The parent's sub-issues created or updated since the last `[daily …]` (`list_issues`, `parentId`, `updatedAt`), with their `[timeline]`, `[finding]`, `[risk]`, `[observe]`.
2. `sdlc-linear-issue-update`: `[daily <yesterday>]` on the parent, one table, a line per sub-issue:

   | issue | problem | status | next |
   |---|---|---|---|

   Nothing happened: one line saying so.
3. Per sub-issue not **Released** nor closed: what its `[observe]` asks to check, checked now with the `debug-*` skill it names. ✋ Then offer Florent to start an agent on it: New worktree, filled with "Use the workflow-oncall-incident skill." (to go on investigating) or "Use the workflow-linear-build skill." (when it was decided to build), and the id.

Done when `[daily <yesterday>]` is posted and Florent has each open incident in one line with the agent offered.
