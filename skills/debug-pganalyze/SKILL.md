---
name: debug-pganalyze
description: Read pganalyze for a production database: slow queries, locks, backends, table and index health. Use when a production problem may come from Postgres.
argument-hint: "<database> <window> <question>"
---

# pganalyze

The `pganalyze` MCP (in `~/dev/pyro/.mcp.json`): `list_servers`, `get_databases`, `get_query_stats` (what got slower, when), `get_query_details` and `get_query_explains`, `get_backends` (what runs and waits now), `get_issues`, `get_tables` and `get_table` (bloat, vacuum), `run_index_selection`.

Return timestamped facts (UTC): the query, its runtime before and during, the waits or locks, the table; each with its pganalyze link.
