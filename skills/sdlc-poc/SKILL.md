---
name: sdlc-poc
description: A throwaway proof of concept that answers the chosen option's doubt, in its own worktree, without a merge request.
disable-model-invocation: true
argument-hint: "<ID or idea slug>"
---

# Proof of concept

Conventions: `~/.claude/skills/sdlc-conventions/SKILL.md`.

1. Write the **question** it answers ("does X hold under Y", "what does Z cost") and the **limit** (a time or a size) in the memory file, and get Florent's yes.
2. A worktree on the branch `poc/<slug>` from the default branch, outside the repo's folder (`git worktree add`). Write its path in the memory file.
3. Build only what answers the question: no tests beyond that, no cleanup, no merge request, never pushed. Commit as you go so the branch keeps it.
4. Past the limit: stop and tell Florent where it stands.

Done when the memory file has the answer (yes, no, or what it costs), what surprised you, and the branch; then `git worktree remove` (the branch stays). Florent has the answer in three lines.
