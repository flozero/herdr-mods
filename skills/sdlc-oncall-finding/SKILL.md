---
name: sdlc-oncall-finding
description: "From [timeline]: the cause, how to fix it, and whether a team must be called, with the message ready."
disable-model-invocation: true
argument-hint: "<sub-issue>"
---

# Finding

Conventions: `../sdlc-conventions/SKILL.md`.

From `[timeline]` and the code:

- **Cause**: what broke and why, three lines, with how sure you are and what would prove it.
- **Fix**: what you would change, now (mitigation) and for good (the fix), with the files or the command.
- **Call a team?**: yes when the cause or the fix is in what another team owns (`CODEOWNERS`, the runbook), or the impact needs them. Who, why, and the message, ready to paste.

`sdlc-linear-issue-update`: `[finding]` with these three.

Done when `[finding]` is posted and Florent knows whether to call someone.
