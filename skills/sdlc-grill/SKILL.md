---
name: sdlc-grill
description: Grill Florent in rounds until a request or Linear issue is clear to both of you, drawing it when it helps; ends with an agreed summary. Use before building anything unclear.
argument-hint: "<ID or the request>"
---

# Understand the problem

After Matt Pocock's `grilling` skill (github.com/mattpocock/skills, MIT). In French, in this terminal.

Read the issue first (`get_issue`, `list_comments`). Map the problem as a **design tree**: each decision branches into the ones that hang off it (what is wrong, for whom, the expected result, what must not change, how we know it works, what is out of scope, how to do it).

Work it in **rounds**. The **frontier** is every decision whose prerequisites are settled: ask all of it in one round, numbered, each with your recommended answer, worded so "oui" accepts it, then wait:

```
❓ **Q1** - **<title>**: <question, with the choices when there are some>

➡️ <your recommended answer>
```

**Facts** are yours to find (code, logs, the issue, the infrastructure): send a sub-agent and ask the rest of the round meanwhile. **Decisions** are his: never answer them yourself.

When the change touches infrastructure or the logic's flow, draw today and after with the excalidraw MCP (`open_canvas`, `draw`), small.

Done when the frontier is empty and he confirms you understand it the same way. Then write **Problem**, **Expected result**, **Out of scope**, **Decisions** (one line each), the drawing's name, and get his yes. Inside `workflow-linear-build` the caller posts it as `[grill]`; alone, post it with `sdlc-linear-issue-update` when there is an issue.
