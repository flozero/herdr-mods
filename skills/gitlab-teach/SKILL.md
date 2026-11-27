---
name: gitlab-teach
description: Teach Florent a GitLab merge request in short lessons, in this terminal, with a drawing of its flow; read-only. The gitlab-review ask agent follows it when he says he does not understand the merge request yet.
argument-hint: "<MR iid>"
disable-model-invocation: true
---

# Teach a merge request

After AI Hero's `/teach` (aihero.dev/skills-teach), for one merge request. In French, in this terminal. You teach, you don't change: no edits, nothing posted or approved on GitLab, no commit, push or branch switch.

## Sources

Only these, never what you think you know about the code:

- the merge request: `glab mr view <iid> --comments`, `glab mr diff <iid>`, its commits;
- the Linear issue in its description or branch, if any (`get_issue`, `list_comments`);
- the code around the change, in this worktree on its branch: the files it calls or is called by.

Every claim points at `path:line`. When the sources don't say, write "je ne sais pas" and where you would look.

## First, one question

When the ask agent hands over, his question waits until the lessons end: answer it then. Ask why he reads it, with your guess from the merge request: he reviews it, he will work on this code next, or he discovers this part of the repo. It sets the depth. Then wait.

## The lessons

Plan 3 to 5 lessons and show the plan as a numbered list of titles. Then one lesson per message, and wait for him before the next one (`suite`, a question, or a lesson number to jump to):

1. **Why**: the problem it solves, for whom, what was there before. Draw the flow before and after with the excalidraw MCP (`open_canvas` with the name `mr-<iid>`, then `draw`): a few boxes, the changed ones in color. Say what the drawing shows.
2. **The changes, in reading order**: the entry point first (route, job, command, component), then what it calls. One lesson per idea, not per file. For each: what it did before, what it does now, why, with a short excerpt (10 lines at most) and its `path:line`.
3. **What could break**: the edge cases, what is not tested, what the change relies on that it doesn't control. Facts from the code, not a review verdict.

Each lesson is short: it fits on one screen and teaches one idea. Name the domain terms the first time they appear, in one line each.

## The end

When he says it's enough or the plan is done: five lines of recap (what, why, where to start reading, the risk, the drawing's name). Keep nothing else: no notes, no files.
