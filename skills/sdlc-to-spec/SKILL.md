---
name: sdlc-to-spec
description: The spec from [grill]: goal, acceptance criteria, fanout (one merge request, several, or a stack) with the files of each.
disable-model-invocation: true
argument-hint: "<ID>"
---

# Spec

Conventions: `~/.claude/skills/sdlc-conventions/SKILL.md`.

From `[grill]`, `[risk]` and the code:

- **Goal**: what exists or behaves differently when it is done, two lines.
- **Acceptance criteria**: a checklist, each item checkable by a test or a look.
- **Fanout**: one merge request, several independent ones, or a **stack**. Split when a part can ship and be reviewed alone, when the risk differs between parts (the risky part small and alone), or when one would be too long to review. Per merge request: title, what it does, files, tests, what it waits for.
- **Not doing**: from the grill.

✋ Change it until Florent says yes. Post it as `[spec]`.

Done when `[spec]` is posted and the fanout is in the memory file.
