---
name: sdlc-conventions
description: The rules every sdlc-* step follows, whichever workflow runs it: language, the memory file, Linear writes, going back to a step.
disable-model-invocation: true
---

# Conventions

- Talk to Florent in French, short. Write in Linear and GitLab in English.
- **Memory file**: the one the running `workflow-*` names (`~/.herdr/workflows/<ID>.md` for an issue, `~/.herdr/ideas/<repo>/worktrees/<slug>.md` for an idea). Read it before a step; after it, add one line: what was decided, what the next steps need. It is how a step, a sub-agent or a session after a compaction knows where things are: never rely on the conversation for it.
- A step does not know which workflow runs it: it reads the memory file, does its part, writes its result. The workflow decides the order.
- Every Linear write goes through `sdlc-linear-issue-update`; a step's output on an issue is a comment with its marker, which later steps read back.
- When Florent sends you back to a step, write his comment in the memory file and start again from that step.
