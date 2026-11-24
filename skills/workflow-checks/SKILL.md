---
name: workflow-checks
description: Review the change on three axes (standards and Florent's style, the agreed spec, security), fix what is found, and set a risk level
disable-model-invocation: true
---

# Checks

Based on Matt Pocock's `code-review` skill (github.com/mattpocock/skills, MIT).

You are in the ticket's worktree. Read the memory file (`~/.herdr/workflows/<ID>.md`) when there is one.

1. Pin the diff: `git diff origin/<default>...HEAD` and `git log origin/<default>..HEAD --oneline`. Stop if it is empty.
2. Run three sub-agents in parallel, each with a fresh context, the diff command, and its own brief (under 400 words each):
   - **Standards**: the repository's documented standards (`CONTRIBUTING.md`, `CODING_STANDARDS.md`, `AGENTS.md`, `CLAUDE.md`, linter configs), `~/.claude/skills/workflow-florent-style/SKILL.md` pasted in full, and the usual smells as judgement calls (mysterious names, duplicated code, speculative generality, data clumps, primitive obsession, shotgun surgery, middle man). The repository's rules win over the smells. Skip what tooling enforces.
   - **Spec**: the agreed summary and the decisions. What is missing or partial, what was done that wasn't asked for, what looks done but wrong. Quote the summary line for each.
   - **Security**: secrets, injection, unchecked input, permissions, data exposed in logs or errors.
3. Show the three reports side by side, not merged. Fix the real findings, run the tests again, commit.
4. Set the risk level from the change itself, as the GitLab `risk::0` to `risk::4` labels, and write it in the memory file:
   - `0` 🔵 trivial: docs, comments, a typo, nothing runs differently;
   - `1` 🟢 low: a two-way door (easy to revert), local, covered by tests;
   - `2` 🟡 moderate: touches shared code, data or behavior other people rely on;
   - `3` 🟠 significant: a one-way door (migration, data deletion, infrastructure, security) with a narrow blast radius;
   - `4` 🔴 elevated: a one-way door with a wide blast radius.
