---
name: sdlc-oncall-investigate
description: "Investigate an on-call incident with the debug-* skills in parallel and turn what they find into a short timeline."
disable-model-invocation: true
argument-hint: "<sub-issue>"
---

# Investigate

Conventions: `../sdlc-conventions/SKILL.md`.

1. From the sub-issue, pick the sources that can show it: `debug-grafana` (metrics, logs, alerts), `debug-sentry` (errors), `debug-k8s` (pods, events), `debug-pganalyze` (slow queries, locks), `debug-psql` (the data), `debug-confluence` (the on-call runbook for it).
2. A sub-agent per source, in parallel, each told the service, the window, the question, and to Read the absolute path of `../debug-<tool>/SKILL.md`. Each returns timestamped facts with their link or query. A fact that opens a new lead: another round on it.
3. Stop when the facts explain the impact from its start, or when a round brings nothing new.

`sdlc-linear-issue-update`: `[timeline]`, one table, one line per event, oldest first, ten lines at most:

| time (UTC) | source | what happened |
|---|---|---|

then the queries and links under it. When the failure path crosses several services, draw it with the excalidraw MCP and name the drawing.

Done when `[timeline]` is posted and Florent has it.
