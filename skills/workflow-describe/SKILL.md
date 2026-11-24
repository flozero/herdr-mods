---
name: workflow-describe
description: Write the merge request description in Florent's tone, with a visual summary, evidence and merge danger, and agree on it with him
disable-model-invocation: true
---

# Merge request description

Based on Matt Pocock's `pr` skill (github.com/mattpocock/skills, MIT).

You are in the ticket's worktree. Read the memory file (`~/.herdr/workflows/<ID>.md`) when there is one. Talk to Florent in French; the description follows the repository's language (usually English).

1. Read `~/.claude/skills/workflow-florent-tone/SKILL.md`. When the repository has a merge request template (`.gitlab/merge_request_templates/`, the team's one), put it at the top as it is (its `ref:` link and quick actions), then this format. Never repeat a line of the template, like its `ref:`, further down:

```markdown
## Summary

<the smallest view that makes the point: pseudocode, a call tree, a file tree, a diff sketch, or a Mermaid diagram>

## Evidence

- **Before:** <failing test, output, screenshot>
  **After:** <passing test, output, screenshot>

## Merge Danger

**Door:** <one-way or two-way> · **Risk:** <only the risk level's dot from `workflow-checks`: 🔵 🟢 🟡 🟠 🔴>
**Blast Radius:** <one word>, <what could break>
```

2. Keep prose short; the visual goes next to the sentence it supports. Link the Linear ticket and the schema when there is one.
3. Show it here and ask Florent whether he understands every line and stands behind it. Change it until he does. When he rewrites a sentence, add the rule it shows to the tone skill's **Learned**.
4. The description is the whole merge request description: no `# Human written description` or `# Claude generated description` sections, no `<details>` fold, no footer. Save it to `~/.herdr/workflows/<ID>-description.md`.
