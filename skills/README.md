# skills

`./install-skills.sh` copies each `skills/<name>/SKILL.md` to `~/.claude/skills/<name>/` (a copy you edited is kept, and a skill this repo no longer ships is removed unless you edited it), and `hooks/*.sh` to `~/.claude/hooks/`.

## workflow-linear-build

The one workflow so far: a Linear issue from understanding it to Released, after Sylvain's AI-SDLC (phase 2, Build). `workflow-*` skills are whole workflows; `sdlc-*` skills are their steps.

```
issue → linear-issue-update (me, In Development) → rebase → grill ✋ → complexity ✋ (risk, type)
      → small and unambiguous? ── yes ──────────────────────────────┐
      → to-spec ✋ (goal, criteria, fanout) → to-tickets (sub-issues) │
      → build-mr per merge request (orchestrate: a worktree and a    │
        sub-agent each) ◄────────────────────────────────────────────┘
          code → review → blt → rebase → create-mr (✋ preview unless trivial)
      → confirm-followup ✋ → watch-mr → deploy ✋ → Released + [recap] → cleanup → cost
```

- ✋: the step waits for your yes.
- Each step reads and extends the memory file `~/.herdr/workflows/<ID>.md`, and posts its result on the issue as a marked comment (`[grill]`, `[risk]`, `[spec]`, `[followup]`, `[recap]`); every Linear write goes through `sdlc-linear-issue-update`.
- Only the `workflow-*` skills, `sdlc-grill` and `sdlc-linear-issue-update` are listed to Claude (their descriptions load every turn); the other steps are `disable-model-invocation: true` and read by path when the workflow reaches them.
- `sdlc-create-mr` needs the excalidraw mod (`./install-excalidraw.sh`) for `export_png`, and `rsvg-convert` (`brew install librsvg`).

## workflow-idea

The phase before: a rough idea, in any repo, to a decision.

```
idea → capture → grill ✋ → explore → options ✋ → technical doubt? → poc (worktree poc/<slug>, no MR)
     → go / park / kill ✋
         kill → why, in the memory file
         park → Linear issue in Backlog
         go   → Linear issue in Todo → hand off to workflow-linear-build
     → cost → park or go: the memory file is deleted, the issue holds everything
```

Its memory file is `~/.herdr/ideas/<repo>/worktrees/<slug>.md`. It writes no spec: that stays in `workflow-linear-build`.

## Steps

A `sdlc-*` step does not know which workflow runs it: it reads the memory file the workflow names, does its part and writes its result (`sdlc-conventions`). Two workflows share a step as it is, or each has its own.

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
