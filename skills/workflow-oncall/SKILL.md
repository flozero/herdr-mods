---
name: workflow-oncall
description: "Start an on-call week (Monday to Monday): the parent Linear issue, its assignee, and a daily sync of the day before until the next Monday's handover. Use when Florent starts an on-call week."
---

# On-call week

Each step is a skill: Read its `../<name>/SKILL.md` (from this skill's base directory) and follow it. Go on by yourself; at ✋ stop until Florent says yes. Run in `~/dev/pyro` (its `.mcp.json` has Grafana, Sentry, pganalyze, Confluence and Kubernetes), in a Herdr space kept open for the week.

1. The team: `oncallTeam` in `~/.herdr/workflows/config.json`; missing, ask Florent once and write it there.
2. ✋ Who is on call this week (default: Florent).
3. `sdlc-linear-issue-update` creates the parent: **On-call <Monday> → <next Monday>** (`YYYY-MM-DD`), in the team, assigned to that person, **In Progress**. Description: the week, who, and "Incidents are its sub-issues; each morning adds a `[daily <date>]` comment." Check first that this week has none (`list_issues`, `query: "On-call <Monday>"`).
4. `CronCreate`, `durable: true`, every day around 9h (`7 9 * * *`): "/sdlc-oncall-daily-sync <PARENT>. When today is the end date in its title, go on with step 5 of /workflow-oncall." Write the job id in the parent's description.
5. The next Monday's run is the last: `sdlc-oncall-daily-sync`, then `[handover]` on the parent: the week in a table (incident, status, what is left), what the next on-call must watch. ✋ Then `CronDelete`, the parent **Done**, `sdlc-cost` (`<PARENT>`).

Done when the parent exists, assigned, and the cron runs; at the week's end, when `[handover]` is posted and the cron deleted.

## Conventions

`../sdlc-conventions/SKILL.md`. The **memory** is the parent issue: no file.
