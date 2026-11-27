---
name: sdlc-build-mr
description: One merge request from its part of [spec]: code, review, build-lint-test, rebase, create the merge request.
disable-model-invocation: true
argument-hint: "<ID or sub-issue ID>"
---

# Build one merge request

Conventions: `~/.claude/skills/workflow-linear-build/SKILL.md`, **Conventions**.

In order: `sdlc-code`, `sdlc-review`, `sdlc-blt`, `sdlc-rebase`, `sdlc-create-mr`. What review or blt finds goes back to `sdlc-code`, then through them again.

Done when the merge request is open and its link is in the memory file.
