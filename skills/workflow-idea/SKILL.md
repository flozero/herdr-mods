---
name: workflow-idea
description: Take a rough idea to a decision: grill, explore, options, a POC when the doubt is technical, then go (a Linear issue ready for workflow-linear-build), park or kill. Use when Florent has an idea, in any repo.
argument-hint: "<the idea>"
---

# From an idea to an issue

The phase before `workflow-linear-build`. Each step is a skill: Read its `~/.claude/skills/<name>/SKILL.md` and follow it. Go on by yourself; at ✋ stop until Florent says yes.

1. **Capture**: the memory file (below), with the idea in Florent's words, the repo, today's date.
2. `sdlc-grill` ✋
3. `sdlc-explore`
4. `sdlc-options` ✋
5. The doubt left is technical (does it work, what does it cost): `sdlc-poc`.
6. ✋ **Go, park or kill**: Florent decides, with the option and the POC's result in front of him.
   - **Kill**: write why in the memory file; the file stays as the record. Go to 8.
   - **Park** or **go**: ask the Linear team, then `sdlc-linear-issue-update` creates the issue (park: **Backlog**; go: **Todo**). Its description, for someone who was not there: **Problem**, **Expected result**, **Out of scope** (from the grill), **Chosen option** and the ones left aside with why, **POC** (what it showed, its branch), the drawings' names. Write the issue's id and url in the memory file.
7. Go: hand off. Tell Florent the issue is ready and offer to open New worktree on it with "Use the workflow-linear-build skill." and the id.
8. `sdlc-cost` (the issue's id; killed: `idea:<slug>`).
9. Park or go: delete the memory file. The issue holds everything now; `workflow-linear-build` starts its own memory file from it.

Done when the idea is killed with its reason written, or is an issue that says everything the memory file did, and the cost is saved.

## Conventions

`~/.claude/skills/sdlc-conventions/SKILL.md`. The **memory file** is `~/.herdr/ideas/<repo>/worktrees/<slug>.md`: `<repo>` the repository's folder name (the current folder's when it is not one), `<slug>` a few words of the idea in kebab-case.
