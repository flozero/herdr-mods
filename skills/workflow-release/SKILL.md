---
name: workflow-release
description: After the merge - list the jobs that ship the change, play them on Florent's go, close the Linear ticket with a short recap
disable-model-invocation: true
argument-hint: "<Linear ID> [merge request link]"
---

# Release

Talk to Florent in French, short. The memory file (`~/.herdr/workflows/<ID>.md`) has the merge request; else use the argument.

1. Find the merge's pipeline on the target branch (`glab api "projects/<group%2Fproject>/pipelines?sha=<merge commit sha>&ref=<target>"`), its jobs (`glab api --paginate "projects/<group%2Fproject>/pipelines/<id>/jobs?per_page=100"`) and child pipelines (`.../pipelines/<id>/bridges`). Keep only the jobs this change concerns, from its changed paths and the job names.
2. Tell Florent the pipeline result (each failed job with its reason from `glab ci trace <job-id>`), then the manual jobs that would ship it, in order, each with what it does. Ask which to run. Never play a job without his go.
3. On go, play them (`glab api -X POST "projects/<group%2Fproject>/jobs/<job-id>/play"`), watch the pipeline (`node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs watch-pipeline <ID> <group/project> <pipeline id>`) and end your turn. When it wakes you, say how they went and go on with the next ones he approved.
4. Post the recap on the ticket once, with `save_comment` on stdin:

```
Done in <merge request link>: <what changed, one or two lines>.
Shipping: <the jobs launched, or "nothing to deploy">.
```

5. When everything he wanted has run, move the ticket to its done state (`save_issue` with `id` and `state`), `node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs unwatch <ID>`, and ask whether to remove the worktree and close the space.
