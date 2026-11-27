---
name: sdlc-orchestrate
description: Several merge requests: one worktree and one sub-agent per sub-issue; a stack in order, independent ones in parallel.
disable-model-invocation: true
argument-hint: "<ID>"
---

# Orchestrate

Conventions: `~/.claude/skills/workflow-linear-build/SKILL.md`, **Conventions**.

1. Per sub-issue, a worktree: `git worktree add --no-track -b <branch> <dir>/<branch slug> <base>`. The base is origin's default branch, or the branch below in a stack; `<dir>` is `worktrees.directory` in `~/.config/herdr-app/settings.json`, else `~/.herdr/worktrees/<repo>`.
2. Per sub-issue, a sub-agent in its worktree, given the sub-issue id, its part of `[spec]`, the memory file's path, and "Follow `~/.claude/skills/sdlc-build-mr/SKILL.md`". Model by risk: Sonnet for 0-2, Opus for 3-4. A stack: each starts once the one below has its merge request. Independent ones: in parallel.
3. A sub-agent stuck on a question: ✋ ask Florent, send the answer back.

Done when every sub-issue has its merge request, and Florent has one line per merge request: link, risk, confidence.
