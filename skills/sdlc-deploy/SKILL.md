---
name: sdlc-deploy
description: After the merge: what deploys by itself, the manual jobs that ship the rest, play the ones Florent approves and watch them.
disable-model-invocation: true
argument-hint: "<ID>"
---

# Deploy

Conventions: `~/.claude/skills/workflow-linear-build/SKILL.md`, **Conventions**.

1. Each merge's pipeline on the target branch (`glab api "projects/<group%2Fproject>/pipelines?sha=<merge sha>&ref=<target>"`), its jobs (`glab api --paginate "projects/<group%2Fproject>/pipelines/<id>/jobs?per_page=100"`) and child pipelines (`.../bridges`); keep the jobs this change concerns.
2. ✋ Tell Florent the result (each failed job with its reason, `glab ci trace`), what deploys by itself, and the manual jobs that ship the rest, in order, with what each does. Never play a job without his go.
3. Play (`glab api -X POST "projects/<group%2Fproject>/jobs/<job-id>/play"`), watch (`linear-me.mjs watch-pipeline <ID> <group/project> <pipeline id>`), end your turn; when woken, report and go on.

Done when everything he approved has run, what was deployed is in the memory file, and `linear-me.mjs unwatch <ID>` ran.
