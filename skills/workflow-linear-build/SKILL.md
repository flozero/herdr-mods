---
name: workflow-linear-build
description: "Build a Linear issue end to end, from understanding it to Released: grill, risk, spec, sub-issues, merge requests, watch, deploy, recap, cost. Use when Florent starts work on an issue (an id like PLA-123)."
argument-hint: "<Linear ID>"
---

# Build a Linear issue

After Sylvain's AI-SDLC, phase 2 (Build). Each step is a skill: Read its `../<name>/SKILL.md` (from this skill's base directory) and follow it. Go on by yourself; at ✋ stop until Florent says yes.

1. `sdlc-linear-issue-update`: assign to Florent, **In Development**.
2. `sdlc-rebase`
3. `sdlc-grill` ✋
4. `sdlc-complexity` ✋
5. Small and unambiguous (risk 0-1, one merge request): go to 8.
6. `sdlc-to-spec` ✋
7. `sdlc-to-tickets` when the spec has several merge requests.
8. One merge request: `sdlc-build-mr`. Several: `sdlc-orchestrate`.
9. `sdlc-confirm-followup` ✋
10. `sdlc-watch-mr`, until each merge request is merged or closed.
11. `sdlc-deploy` ✋
12. `sdlc-linear-issue-update`: **Released**, and `[recap]`: what was deployed, and how and why it differs from `[spec]`.
13. `sdlc-cleanup`
14. `sdlc-cost`

Done when the issue is Released, its `[recap]` posted, the worktrees removed and the cost saved.

## Conventions

`../sdlc-conventions/SKILL.md`. The **memory file** is `~/.herdr/workflows/<ID>.md`: create it at step 1 (issue id, title, url, branch, worktree).
