---
name: sdlc-rebase
description: "Rebase the branch on origin's default branch (or the branch below, in a stack), solving conflicts whose intent is clear."
disable-model-invocation: true
---

# Rebase

Conventions: `../sdlc-conventions/SKILL.md`.

1. `git fetch origin`; `git rebase origin/<default>` (from `git symbolic-ref --short refs/remotes/origin/HEAD`), or on the branch below in a stack.
2. A conflict whose intent is clear on both sides: resolve it, run the tests. Else stop and show Florent the conflict.
3. When the branch is pushed: `git push --force-with-lease`.

Done when `git status` is clean and the branch has every commit of its base.
