---
name: sdlc-code
description: "Implement the spec's part without asking: tracer bullet, test first, deviations and out-of-scope findings written down instead of asked."
disable-model-invocation: true
argument-hint: "<ID>"
---

# Code

After Matt Pocock's `implement` and `tdd` skills (github.com/mattpocock/skills, MIT). Conventions: `../sdlc-conventions/SKILL.md`.

The spec is agreed: ask Florent nothing. Follow `../sdlc-florent-style/SKILL.md`.

1. A tracer bullet first: the thinnest path through every layer the change touches, then widen it.
2. Test first where there is a seam: red, green, next. Type checker and the single test files as you go.
3. The spec doesn't fit the code: the smallest change that keeps its intent, written under **Deviations** in the memory file. Something out of scope: under **Follow-ups**, not done.
4. Commit with clear messages. Don't push.

Done when every acceptance criterion of this merge request has a passing test or a check, and it is committed.
