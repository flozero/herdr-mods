---
name: workflow-oncall-incident
description: An on-call incident from a short explanation: identify it, investigate with the debug-* skills, a timeline, whether to call a team, the finding with its fix and risk, as a sub-issue of the week's on-call parent; then build, observe or close. Use when Florent has an on-call problem.
argument-hint: "<short explanation, or the sub-issue to go on with>"
---

# On-call incident

Each step is a skill: Read its `~/.claude/skills/<name>/SKILL.md` and follow it. Go on by yourself; at ✋ stop until Florent says yes. Run in `~/dev/pyro`. Everything you run on production only reads.

1. **Capture**: the week's parent (`list_issues`, `query: "On-call"`, open, the one whose dates hold today); none: say so and offer `workflow-oncall`. `sdlc-linear-issue-update` creates the sub-issue: a short title, Florent's explanation and the time as description, **In Progress**, assigned to the parent's assignee. Given an existing sub-issue: read its comments and go on from the last step it has.
2. **Identify**, one round at most, numbered, each with your guess: the service, since when, the impact (who, how many), how urgent. What you can find yourself, find.
3. `sdlc-oncall-investigate`: `[timeline]`.
4. `sdlc-oncall-finding`: `[finding]`, with whether to call a team.
5. `sdlc-complexity` ✋ on the fix: `[risk]`.
6. ✋ **Next**, Florent picks:
   - **Build**: offer New worktree on the sub-issue with "Use the workflow-linear-build skill."
   - **Observe**: `[observe]` for tomorrow's agent: what to check, with which `debug-*` skill and query, the threshold that would change the decision, and when.
   - **Close**: why, then **Done**.
7. `sdlc-cost` (the sub-issue).

Done when the sub-issue has `[timeline]`, `[finding]`, `[risk]` and its next step.

## Conventions

`~/.claude/skills/sdlc-conventions/SKILL.md`. The **memory** is the sub-issue: no file.
