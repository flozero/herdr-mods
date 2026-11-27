---
name: sdlc-blt
description: Build, lint and test the branch the way its CI does.
disable-model-invocation: true
argument-hint: "<ID>"
---

# Build, lint, test

Conventions: `~/.claude/skills/workflow-linear-build/SKILL.md`, **Conventions**.

Run locally what the CI runs for these changes (`.gitlab-ci.yml`, `Makefile`, `package.json`, `pyproject.toml`): build, linters and formatters, type checker, the whole test suite. A failure from this change goes back to `sdlc-code`; one that fails on the default branch too is noted, not fixed.

Done when each command passes, or fails on the default branch too, and its result is a line in the memory file.
