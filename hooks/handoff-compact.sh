#!/bin/sh
# PreCompact: what Claude Code prints here becomes the compaction's instructions.
cat <<'TEXT'
Write the summary as a handoff: the agent that reads it starts with nothing else. Keep only:
- Goal: the task in one line, and the Linear issue id when there is one.
- Where: the step you are in (in workflow-linear-build, its number and skill), what is done, what is in progress.
- Decisions: each one Florent made, one line each, in his words.
- Work: the repo, the worktree and branch, the files changed, the merge request links.
- Next: the exact next action.
- Open: the questions waiting for Florent.
- Pointers: the memory file (~/.herdr/workflows/<ID>.md), the Linear comments ([grill], [risk], [spec]), the drawings.
Leave out tool output, code that is committed, and what the memory file already holds.
TEXT
