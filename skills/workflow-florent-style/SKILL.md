---
name: workflow-florent-style
description: Florent's coding style and the mistakes he doesn't want to see again, read by workflow-implement and workflow-checks
disable-model-invocation: true
---

# Florent's style

Read this before writing or checking code. When Florent corrects something that isn't here, add one line under **Learned**, in his words, so it doesn't happen again.

## Code

- No comments in code. The code explains itself; if it doesn't, rename or split it.
- A docstring only when it is one line and really needed.
- Small, direct functions. No abstraction for one use. No dead code, no unused options.
- Follow the file you are in: its naming, its patterns, its error handling.
- Errors are shown to the person, never swallowed silently.
- Tests next to what they test, testing behavior, not implementation.

## Learned

