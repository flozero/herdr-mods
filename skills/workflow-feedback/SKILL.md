---
name: workflow-feedback
description: Use when a skill, a Herdr mod, a CLI or the environment got in your way (wrong instruction, missing permission, a command that fails, a step you had to work around) - records it for Florent to fix later
---

# Report a problem

Append one entry to `~/.herdr/feedbacks.md`, then carry on with your task:

```markdown
## <date> · <skill, mod or tool> · <one line: what went wrong>

- **Where:** <repository, worktree, skill or command>
- **What happened:** <the command and the error, redacted, a few lines>
- **Worked around by:** <what you did instead, or "blocked">
- **Suggested fix:** <the change to the skill, mod or setup>
```

One entry per problem, no duplicates of an entry already there. Don't stop your task for it, and tell Florent in one line that you recorded it.
