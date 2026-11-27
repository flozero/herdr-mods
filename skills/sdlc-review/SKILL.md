---
name: sdlc-review
description: Review the diff against the spec, the standards and security with three fresh sub-agents, fix what is real, set a confidence level.
disable-model-invocation: true
argument-hint: "<ID>"
---

# Review

After Matt Pocock's `code-review` skill (github.com/mattpocock/skills, MIT). Conventions: `~/.claude/skills/workflow-linear-build/SKILL.md`, **Conventions**.

1. The diff: `git diff <base>...HEAD`, `git log <base>..HEAD --oneline`.
2. Three sub-agents in parallel, fresh contexts, each given the diff command:
   - **Spec**: this merge request's part of `[spec]`: missing, partial, not asked for, done but wrong; the spec line for each.
   - **Standards**: the repository's (`CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, linter configs), then `~/.claude/skills/sdlc-florent-style/SKILL.md`; the repository wins; skip what tooling enforces.
   - **Security**: secrets, injection, unchecked input, permissions, data in logs or errors.
3. Fix the real findings, commit.

Done when the memory file has the **confidence** (low, medium, high) that it does what the spec says and breaks nothing, why, and each finding left with its reason.
