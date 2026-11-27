# skills

The workflows and their steps (`workflow-*`, `sdlc-*`, `debug-*`) are here and in flare-claude-skills, `skills/fgiraud` (not a plugin, so no `fgiraud:` prefix), whose `install.sh` links them into `~/.claude/skills`. Change them in one, copy to the other. A skill linked like that is left alone by `./install-skills.sh`.

`./install-skills.sh` copies each `skills/<name>/SKILL.md` still here to `~/.claude/skills/<name>/` (a copy you edited is kept, and a skill this repo no longer ships is removed unless you edited it), and `hooks/*.sh` to `~/.claude/hooks/`.

## Compaction

In `~/.claude/settings.json`, not set by the install:

```json
"autoCompactWindow": 200000,
"hooks": {
  "PreCompact": [{ "hooks": [{ "type": "command", "command": "sh \"$HOME/.claude/hooks/handoff-compact.sh\"" }] }],
  "SessionStart": [{ "matcher": "compact", "hooks": [{ "type": "command", "command": "sh \"$HOME/.claude/hooks/after-compact.sh\"" }] }]
}
```

A session compacts at 200k tokens instead of near the model's window. `handoff-compact.sh` makes the summary a handoff (goal, step, decisions, work, next action, open questions, pointers); `after-compact.sh` sends the agent back to the memory file and the current step's skill.
