---
name: workflow-review
description: Open the change in the Herdr code editor for Florent to review, and apply his comments
disable-model-invocation: true
---

# Florent's review

You are in the ticket's worktree.

1. Open the code editor on the changes, in a new tab:

```sh
herdr-app do tab.new '{"name":"Code · <worktree folder name>","mod":"code","props":{"root":"<worktree>","mode":"changes"}}'
```

2. Tell Florent in one line: the risk level, what to look at first, and that he can comment lines in the editor and send the review, or answer here.
3. Wait. Apply each comment, run the tests, commit, and say what you changed. When he says it's good, go on.
