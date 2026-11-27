---
name: sdlc-complexity
description: From the [grill] summary and the code: complexity, risk 0-4, work type, small-and-unambiguous, confidence.
disable-model-invocation: true
argument-hint: "<ID>"
---

# Complexity and risk

Conventions: `~/.claude/skills/sdlc-conventions/SKILL.md`.

From `[grill]` and the code it touches:

- **Complexity**: what changes, where, how much; **small and unambiguous** when it is one merge request with one obvious way and nothing left to decide.
- **Risk**, from what breaks if it is wrong and how hard it is to undo:
  - `0` 🔵 nothing runs differently: docs, comments, a typo;
  - `1` 🟢 a two-way door: local, covered by tests, easy to revert;
  - `2` 🟡 shared code, data or behavior others rely on;
  - `3` 🟠 a one-way door (migration, data deletion, infrastructure, security), narrow blast radius;
  - `4` 🔴 a one-way door, wide blast radius.
- **Work type**: one of the team's `type` labels.
- **Confidence** (low, medium, high) that the plan holds, with why.

✋ Florent's yes or correction. Then `sdlc-linear-issue-update`: `[risk]` (these four, three lines), `risk-N`, the type label.

Done when the labels are set and the four values are in the memory file.
