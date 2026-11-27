---
name: sdlc-explore
description: "What already exists around a grilled idea: the code, the Linear issues that overlap it, the constraints, how others do it."
disable-model-invocation: true
argument-hint: "<ID or idea slug>"
---

# Explore

Conventions: `../sdlc-conventions/SKILL.md`.

From the grill's summary, find (facts, not decisions; send sub-agents in parallel when the parts are independent):

- **Code**: what already does part of it, where it would go, what it would touch.
- **Linear**: issues and projects that overlap it (`list_issues` with `query`, open and closed); one that already covers it: say so first.
- **Constraints**: what limits it (infrastructure, data, dependencies, people who own that code).
- **Elsewhere**: how a library, a tool or another team does it, when that helps.

Done when the memory file has these four, each with its pointers (paths, issue ids, links), and Florent has them in five lines.
