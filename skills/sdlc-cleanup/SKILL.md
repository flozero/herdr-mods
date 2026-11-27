---
name: sdlc-cleanup
description: "Remove the worktrees and spaces of what is deployed and Released."
disable-model-invocation: true
argument-hint: "<ID>"
---

# Clean up

Conventions: `../sdlc-conventions/SKILL.md`.

Each merge request deployed whose issue is **Released**: close its Herdr space, run the teardown (`worktrees.teardown`, the repo's `.herdr/settings.json`), `git worktree remove`. One with uncommitted or unpushed changes stays: say so. The worktree you run in goes last, after `sdlc-cost`.

Done when only the worktrees with changes left remain, each named to Florent.
