---
name: sdlc-to-tickets
description: One Linear sub-issue per merge request of [spec].
disable-model-invocation: true
argument-hint: "<ID>"
---

# Sub-issues

Conventions: `~/.claude/skills/workflow-linear-build/SKILL.md`, **Conventions**.

Per merge request of `[spec]`, with `sdlc-linear-issue-update`: a sub-issue of `<ID>` with the merge request's title, its part of the spec (goal, criteria, files) as description, its risk label, assigned to Florent.

Done when each sub-issue's id, branch (`gitBranchName`) and what it waits for are in the memory file.
