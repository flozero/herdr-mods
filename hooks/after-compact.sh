#!/bin/sh
# SessionStart after a compaction: send the agent back to the memory file before it goes on.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"The conversation was just compacted. When the summary names a memory file (~/.herdr/workflows/<ID>.md, or ~/.herdr/ideas/<repo>/worktrees/<slug>.md for an idea), read it, then the SKILL.md of the step in progress, before doing anything else."}}
JSON
