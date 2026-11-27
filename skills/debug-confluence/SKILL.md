---
name: debug-confluence
description: "Find the on-call runbook or process in Confluence (the engineering knowledge base) that matches a production problem. Use when investigating a production problem."
argument-hint: "<the problem, or the alert's name>"
---

# Confluence

The `flare-mcp-internal` MCP (in `~/dev/pyro/.mcp.json`): `eng_kb_search_pages` with the alert's name, the service and the symptom, then `eng_kb_fetch_page` on the best ones; `eng_kb_list_pages` to browse.

Return the page that matches with its link: what it says to check, to do, and whom to call; and say when nothing matches.
