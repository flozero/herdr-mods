---
name: workflow-grill
description: Grill Florent in rounds until the problem is clear to both of you, draw a schema when it helps, end with an agreed summary
disable-model-invocation: true
---

# Understand the problem

Based on Matt Pocock's `grilling` skill (github.com/mattpocock/skills, MIT).

Talk to Florent in this terminal, in French. Interview him until you reach a shared understanding of the problem. Map it as a **design tree**: every decision branches into the decisions that hang off it (what is wrong, for whom, the expected result, what must not change, how we know it works, what is out of scope, how to do it).

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are settled. Ask the whole frontier in one round, numbered, each with your recommended answer, then wait:

```
❓ **Q1** - **<title>**: <question, with the choices when there are some>

➡️ <your recommended answer>
```

Word each question so "oui" accepts your recommendation. A question that depends on another one still open belongs to a later round.

Finding **facts** is your job, never his: the code, the logs, the Linear ticket, the infrastructure. When a question needs a fact, send a sub-agent to find it, and ask the rest of the round meanwhile. The **decisions** are his: put each to him and wait. Never answer them yourself.

When the change touches infrastructure, or changes logic in the code (a flow, a state, who calls whom), draw it with the excalidraw MCP (`open_canvas` with a short name, then `draw`): today and after. Keep it small; skip it when it wouldn't help.

Done when the frontier is empty and he confirms you share the same understanding. Then write the summary here: **Problem**, **Expected result**, **Plan** in a few lines, **Out of scope**, **Decisions** (one line each), the schema's name. Get his yes. When there is a Linear ticket already, post the summary on it as one comment (`save_comment`, the JSON on stdin, see below).

Linear goes through `node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs call <tool> -` with the JSON arguments on stdin in a quoted heredoc: this machine kills a `node` whose argument is about 1000 characters or more.
