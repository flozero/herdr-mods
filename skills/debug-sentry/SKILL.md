---
name: debug-sentry
description: "Read Sentry for a production problem: the issues and errors of a service in a window, their stack traces, the release that brought them. Use when investigating a production problem."
argument-hint: "<service> <window> <question>"
---

# Sentry

The `sentry` MCP (in `~/dev/pyro/.mcp.json`): `search_issues` for what is broken, `search_errors` for counts over time, `get_sentry_resource` and `get_issue_details` for an issue, `get_event_stacktrace`, `find_releases`. Only read: no `update_issue`, no notes.

Return timestamped facts (UTC): first and last seen, count, the release, the top frame; each with its link.
