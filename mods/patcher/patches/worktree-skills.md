# worktree-skills

New worktree starts the agent with skills you pick, and its first message has several lines.
Linear's Work with the agent opens this same dialog, filled in, instead of its own.

Made on top of: `statusbar`.

## What it does

In `mods/worktree` → `my-worktree` (New worktree):

- **Skills**: a sidebar on the right lists the skills in `~/.claude/skills` and the repo's
  `.claude/skills` (on the space's machine) whose name starts with the prefix typed at its top,
  with their description; `manual` tags a skill with `disable-model-invocation: true`. A click
  writes "Use the <name> skill." on its own line where the cursor is in the message, so the
  message stays yours to arrange. The prefix (`workflow-` at first, several split by commas,
  empty for all) is kept in `~/.config/herdr-app/.cache/worktree-skills.json`.
- **First message**: a field of several lines. Enter goes to the next line, ⌘↵ creates,
  Tab goes message → branch → space name → prefix.
- **Props**: `ask: true` fills the fields from `{ branch, name, message }` and waits for ⌘↵
  instead of creating at once. `task` goes after what was typed (Linear's issue).
- While it creates, the message and the prefix are plain text too, and the skills don't click.
- `my-menu`, `my-new-menu` and `worktree-new` open New worktree at 800×560.

## What it expects from the patched copy

- `mods/worktree/main.js` after `statusbar`: the gpui-base import line, `import { checking } from "herdr";`,
  the `this.message = InputState.new(…)` lines and the focus loop over `message` and `spaceName`,
  `if (repo && this.opening) this.list = …`, `if (props().branch) await this.work(cx);`, `first()`,
  `go()`'s `cx.spawn(async (cx) => this.work(cx));`, `create()`'s `const task = …`, `key()`'s Tab
  order and its remove Enter, and `render()`'s root `v_flex()` (now the left column), message field, naming line and footer.
- `mods/menu/main.js`: `it[2].action === "new" ? { width: 440, height: 400 }`.
- `mods/new-menu/main.js`: New worktree's `width: 460, height: 400`.

## How to check it works

- ⌘⇧N: the SKILLS sidebar lists your `workflow-*` skills, tagged `manual`. Type `linear-` in the
  prefix: the list changes; close and open again: `linear-` is still there.
- Type a line, click two skills: each lands on its own line under the cursor. ⌘↵: the agent's
  first message is exactly what the field shows.
- Linear, Actions → Start a new worktree with agent: the dialog opens with the issue's branch
  and id as the space name, and creates only on ⌘↵.
