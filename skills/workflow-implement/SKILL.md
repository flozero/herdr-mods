---
name: workflow-implement
description: Implement the agreed change in its worktree, test first at the right seams, in Florent's style, and commit
disable-model-invocation: true
---

# Implement

Based on Matt Pocock's `implement` and `tdd` skills (github.com/mattpocock/skills, MIT).

You are in the ticket's worktree. Read the memory file (`~/.herdr/workflows/<ID>.md`) when there is one: the agreed summary and the decisions are there.

1. Rebase the branch on the default branch: `git fetch origin && git rebase origin/<default>`. On a conflict, resolve it when the intent of both sides is clear, run the tests again, else stop and ask Florent.
2. Read `~/.claude/skills/workflow-florent-style/SKILL.md` and follow it.
3. Read the code around the change before changing it. Do what was agreed, nothing more; note anything else you find for the summary.
4. Test first where there is a seam to test: write the failing test, make it pass, then the next. Run the type checker and the single test files as you go, the whole suite once at the end, and the project's linters.
5. Commit on the branch with a clear message. Don't push.
6. Say what changed, the tests, and what was left out on purpose.
