# statusbar

The footer shows the active space's merge request and Linear issue next to its branch, and
publishes what it fetched for the other mods to read.

Made on top of: `configurable-agent`.

## What it does

- `my-workspace-status` (the footer): for the active space on this computer, one GitLab GraphQL
  call (current user, the branch's open merge request, its pipeline, its unresolved threads) and,
  when the linear mod is installed, `linear-me.mjs batch get_issue` on the identifiers in the
  branch name. At once when the space or branch changes, then every 60 s (15 s while the pipeline
  runs). The fetching lives in the new `context.js`.
- Clicks: the branch opens the code editor on the checkout, the merge request GitLab Review in
  local mode, the issue the Linear tab (an existing Linear tab gets `linear.open:<ID>`, else a new
  tab opens on the issue). An existing tab is selected instead of opening another.
- Shared state `statusbar.context`: `{ [repository root]: { branch, fetchedAt, gitlab: { host, project, me }, mr, issue } }`,
  written only when the entry changed (or once a minute), entries older than a day dropped.
  gitlab-review and the code editor use it when it is under 2 minutes old for the same branch,
  and call GitLab themselves otherwise.
- `my-main` uses `my-workspace-status` for its `status` block.

## What it expects from Herdr's original

- `layouts/main.json`: the `status` block's `"mod": "workspace-status"`.
- `mods/workspace-status/main.js`: the class `WorkspaceStatus` with `hint(t)` and `render()`
  building the `h_flex` row (machine label, branch label, agents, spacer, palette). The patch
  rewrites `render()` and adds `init`, so a release that changes the footer means redoing the
  patch on the new `render()`.

## How to check it works

- On a branch with an open merge request: the footer shows `!iid`, the pipeline and the threads;
  clicking it opens GitLab Review on the checkout.
- On a branch named after a Linear issue (`me/pla-663-…`): the footer shows `PLA-663 · <status>`;
  clicking it opens the issue.
- Clicking the branch opens the code editor.
- Switching spaces updates the footer within a few seconds.
