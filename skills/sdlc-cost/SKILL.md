---
name: sdlc-cost
description: What the issue's agent sessions cost, saved per day and per issue in ~/dev/costs/<year>/<month>/agent-costs.json.
disable-model-invocation: true
argument-hint: "<ID>"
---

# Cost

Conventions: `~/.claude/skills/workflow-linear-build/SKILL.md`, **Conventions**.

1. Sessions: this one (`$CLAUDE_CODE_SESSION_ID`), its sub-agents, and every `claude --resume` id in the memory file and the merge request descriptions. Transcripts: `~/.claude/projects/*/<id>.jsonl`; sub-agents under `~/.claude/projects/*/<id>/subagents/`.
2. Sum each assistant message's `message.usage` (input, output, cache write, cache read) per model; price it with Anthropic's current pricing page, not memory.
3. Merge into `~/dev/costs/<year>/<month>/agent-costs.json`: read it just before writing, write a temporary file, move it over. A session already in `sessions` is not counted again.

```json
{ "sessions": ["<id>"], "days": { "2026-11-27": { "usd": 0, "tokens": { "input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0 }, "issues": { "<ID>": 0 } } } }
```

Done when the file has today's line and Florent has the issue's total and today's.
