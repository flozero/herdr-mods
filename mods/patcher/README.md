# Patcher

Keeps our changes to Herdr's own mods and layout as patches on copies, so the copies
follow Herdr's updates and a release that breaks a change is caught, not lost. The idea and
most of the code come from Frédéric Morin's patcher (fredericmorin/herdr-app, `mods/patcher`).

Herdr replaces its shipped mods and layouts at every start, so they can't be changed in
place. `main.js` has three lists:

- `COPIES`: Herdr's originals that get a copy (`mods/worktree` → `mods/my-worktree`,
  `layouts/main.json` → `layouts/my-main.json`, …);
- `PATCHES`: `patches/<name>.patch`, applied in that order;
- `STACKS`: the folders of `patches/` tried in turn. `patches/` is made on Herdr's `master`, `patches/0.1.18/` on the v0.1.18 release; the first stack that applies whole is used. Older releases aren't patched anymore.

The patcher copies every original to a temporary folder at its own path
(`mods/worktree/…`), applies each patch there with `git apply` (exact context, no fuzz),
checks each copy that differs from the installed one (`herdr-app check` for a mod, valid
JSON for the layout) and installs those. Then a toast says it worked and which copies
changed; outside `my-main`, clicking it switches to that layout.

It runs at every start only in the `my-main` layout: a mod runs only where a layout places
it, and `my-main` is the only layout with the patcher's hidden block (Herdr rewrites `main`
at every start, so it can't be added there). In any other layout, nothing is applied at start
and the patched copies aren't shown. `cmd-alt-p` (`ctrl-alt-p` on Linux, or
`herdr-app do mod.open --name patcher`) applies them again from any layout, shows each
patch and copy, and switches to the `my-main` layout once they all applied.

All copies change together or not at all. When a patch fails, the last working copies stay,
`~/.config/herdr-app/patcher.error` says which patch and why, and an error toast opens the
patcher window.

The copies (`mods/my-*`, `layouts/my-main.json`) are generated: never edit them, edit the
patches. Each generated mod folder has a `GENERATED.md` listing the patches that changed it.

## Settings

Patched mods read the person's `~/.config/herdr-app/settings.json` (Herdr keeps keys it
doesn't know when it rewrites the file) and the project's `<main checkout>/.herdr/settings.json`.
The project wins. Each mod has its own key: `worktrees` for the worktree dialog, see
`patches/worktree-settings.md` and `patches/new-worktree-dialog.md`.

```json
"worktrees": {
  "directory": "~/.herdr/worktrees",
  "setup": "sh ~/.herdr/worktree-setup.sh",
  "teardown": "",
  "deleteBranch": false,
  "branchPrefix": "me/",
  "repos": { "~/dev/my-repo": { "directory": ".claude/worktrees", "deleteBranch": true } }
}
```

## One patch per change, stacked

A patch is one coherent change, across as many copies as it needs, named after what it
changes (`worktree-settings`), never after a file. Patches are stacked: each one is made on
top of Herdr's originals with every patch before it in `PATCHES` applied. Most of them
change the same worktree dialog, so independent patches would fight over the same lines.

Each `patches/<name>.patch` has a `patches/<name>.md`: what it's made on top of, what it
does, what it expects from Herdr's original (the exact functions, calls and strings it
hooks into: what to find again when a release moves the code), and how to check it works.
Change the `.md` with its patch.

## Writing or fixing a patch

A patch is `diff -ru a b`, run where `a/` and `b/` mirror the originals at their paths
under `~/.config/herdr-app`. Run `git apply` outside any git repo.

When Herdr updates and a patch fails (say `worktree-settings`):

```sh
H=~/.config/herdr-app; P=$H/mods/patcher/patches
cd "$(mktemp -d)" && mkdir -p a/mods a/layouts
cp -R $H/mods/worktree $H/mods/menu $H/mods/new-menu $H/mods/spaces $H/mods/tabs a/mods/
cp $H/layouts/main.json a/layouts/
for p in use-patched-copies sync-new-worktrees; do (cd a && git apply $P/$p.patch); done
cp -R a b
(cd b && git apply --reject $P/worktree-settings.patch)
# Redo the hunks left in b/**/*.rej by hand, following the .md, then delete the .rej files.
diff -ru a b > $P/worktree-settings.patch
```

Then rebuild the patches after it the same way, each on the new one, and check
`tests/patcher-worktree.test.mjs` in herdr-mods passes. Edit the patches in herdr-mods and
reinstall: the patcher applies them at the next start, or now with Apply again.
