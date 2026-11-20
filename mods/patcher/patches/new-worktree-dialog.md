# new-worktree-dialog

New worktree asks for a first message to Claude, the branch (suggested from the message)
and the space's name. With a message, the new space starts Claude on it; Linear's Work with
Claude uses the same dialog.

Made on top of: `remove-locked-worktrees`.

## What it does

In `mods/worktree` → `my-worktree` (New worktree):

- Three fields, Tab / ⇧Tab between them: "first message to Claude (optional)" (focused),
  the branch, "space name (optional)". Enter in any of them creates.
- While the message is typed, `claude -p --model haiku` names the branch after it
  (`<worktrees.branchPrefix><words-with-hyphens>`, 700 ms after typing stops), until the
  branch is typed by hand. Enter while it's naming waits for the name.
- A new branch starts from origin's default branch (`origin/HEAD`, fetched first), not
  `--track`ed; without `origin/HEAD`, from `HEAD`.
- The space gets the typed name (unnamed otherwise, as Herdr does). With a message it runs
  `claude` with the message as its first one (after the setup); without one, a shell.
- Props from another mod win: `{ branch, argv, task, tab, repoSpace }`. Linear's Work with
  Claude (`worktreeMod: "my-worktree"`) passes them; with `branch` the dialog creates at once.
  `repoSpace: true` opens the repo's main checkout space first, so the worktree nests under it.
- `my-menu` and `my-new-menu` open New worktree 400px high to fit the fields.

## What it expects from Herdr's original

- `mods/worktree/main.js`:
  - `export default class Worktree extends View {`: the naming prompt and `toSlug` go before it.
  - `init()`: `this.inputFocused = true;`, the input's `blur` handler (the fields go after it),
    `if (props()?.action !== "remove") this.input.focus();` and later
    `cx.timer.after(100, () => this.input.focus())`.
  - `go(cx)` starting with `if (this.busy || !this.repo) return;`.
  - `work()`'s `await this.create()`; `create()`'s
    `["worktree", "add", "-b", branch, path, "HEAD"]`.
  - `worktree-settings`' lines in `create()` (`const argv = setup.length ? withSetup(…)`
    and its `run("space.new", …)`) and its `deleteBranch:` line in `worktreeSettings`.
  - `key(e, cx)` starting with `if (e.key === "escape") return this.close();`.
  - `render()`: the New text ending "a new one starts from here.", and the New input
    `.when(!remove && !blocked, (el) => el.child(Input.new(this.input) … .text_color(t.foreground), ), )`.
- `mods/menu/main.js`: `choose()`'s `{ width: 440, height: 260 }` for the worktree dialog.
- `mods/new-menu/main.js`: New worktree's `openOverlay({ mod: "my-worktree", kind: "dialog", width: 460, height: 280, …`.

## How to check it works

- ⌘⇧N (or + → New worktree…): the message field has the keyboard. Type "fix the login
  redirect": after a moment the branch reads `<prefix>fix-login-redirect`.
- Type a space name, Enter: a space with that name, nested under the repo, runs the setup
  then Claude with the message.
- Clear the message, type a branch, Enter: a shell in the new checkout.
- Linear, `c` on an issue: the worktree is made and Claude starts on the skill's task.
