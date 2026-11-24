---
name: workflow-ship
description: Push, open the draft merge request with the agreed description and risk label, and comment the handoff on Linear
disable-model-invocation: true
---

# Draft merge request and handoff

You are in the ticket's worktree. The memory file (`~/.herdr/workflows/<ID>.md`) has the branch, the ticket and the risk level; the description is `~/.herdr/workflows/<ID>-description.md`.

1. Rebase on the default branch: `git fetch origin && git rebase origin/<default>`. On a conflict, resolve it when the intent of both sides is clear, run the tests again, else stop and ask Florent. Then push the branch: `git push -u --force-with-lease origin <branch>`.
2. Open the merge request as a draft with `glab` directly, not the `commit-and-open-mr` skill, so the description stays as agreed: `glab mr create --draft --title "<what changes>" --description "$(cat <description file>)" --target-branch <default> --label "risk::<0-4>" --yes`. When it exists already, `glab mr update <iid> --description "$(cat <description file>)" --unlabel <old risk label> --label "risk::<0-4>"`. If the label doesn't exist in the project, open it without and say so.
3. Comment on the Linear ticket with his account (`node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs call save_comment -` and the JSON on stdin): the merge request link, what changed in a few lines, the risk level, and what is left for whoever picks it up.
4. Write the merge request link in the memory file and give it here.
