---
name: sdlc-linear-issue-update
description: Write to Linear: a new issue, a marked comment ([grill], [risk], [spec], [followup], [recap], and on-call's [timeline], [finding], [observe], [daily], [handover]), the status, the assignee, the risk-0..risk-4 and work-type labels, sub-issues. The one writer to Linear in the sdlc flow.
argument-hint: "<ID> <what to change>"
---

# Update the Linear issue

Conventions: `~/.claude/skills/sdlc-conventions/SKILL.md`.

Linear goes through `node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs call <tool> -` with the JSON on stdin in a quoted heredoc (`<<'EOF'`): this machine kills a `node` whose argument is about 1000 characters or more.

- **Comment**: `save_comment` (`issueId`, `body`). The first line is the marker: `[grill]`, `[risk]`, `[spec]`, `[followup]`, `[recap]`, `[timeline]`, `[finding]`, `[observe]`, `[daily <YYYY-MM-DD>]`, `[handover]`. One comment per marker: when it exists (`list_comments`), update it (`id`).
- **Status**: `list_issue_statuses` for the issue's team, then `save_issue` (`id`, `state`: the status id). No status of that name in the team: stop and say so.
- **Assignee**: `save_issue` with `assignee: "me"`, or the person named (`list_users` when the name is ambiguous).
- **Risk**: the single-select group `risk` with `risk-0` to `risk-4`. When the team lacks it (`list_issue_labels`, `team`, `includeGroups: true`), create it with `save_issue_label` (`isGroup: true`, `teamId`), then its labels (`parent: "risk"`; `#4ea7fc`, `#4cb782`, `#f2c94c`, `#f2994a`, `#eb5757`).
- **Work type**: one label of the team's `type` group, only when the issue has none.
- **Issue**: `list_issues` (`query`, `team`) for one that already covers it: there is one, stop and show it to Florent. Else `save_issue` (`team`, `title`, `description`, `state`), assigned to Florent.
- **Sub-issue**: `save_issue` (`team`, `title`, `description`, `parentId`).

Labels change with `addLabels` and `removeLabels`, never `labels` (it replaces them all).

Done when Linear shows the change (`get_issue`, `list_comments`).
