-- Herdr's shortcuts, and its mods', are the macOS ones with cmd = Super (see the herdr-mods README, "Linux and Omarchy").
-- This frees the Omarchy chords they need. SUPER + Return (terminal), SUPER + Q (close window) and the
-- universal clipboard (SUPER + C / V / X / A) stay.

-- Herdr's mods (keys/*.linux.json)
for _, keys in ipairs({
  "SUPER + F",                 -- Full screen                            -> cmd-f: search
  "SUPER + I",                 -- Switch input language                  -> cmd-i: Linear issue
  "SUPER + S",                 -- Toggle scratchpad                      -> cmd-s: Sentry issue
  "SUPER + SHIFT + C",         -- Calendar                               -> cmd-shift-c: copy as curl
  "SUPER + SHIFT + E",         -- Email                                  -> cmd-shift-e: Excalidraw
  "SUPER + SHIFT + F",         -- File manager                           -> cmd-shift-f: search in the project
  "SUPER + SHIFT + G",         -- Signal                                 -> cmd-shift-g: GitLab review
  "SUPER + SHIFT + I",         -- Switch input language back             -> cmd-shift-i: Linear
  "SUPER + SHIFT + N",         -- Editor                                 -> cmd-shift-n: New worktree
  "SUPER + SHIFT + O",         -- Obsidian                               -> cmd-shift-o: Open worktree
  "SUPER + SHIFT + S",         -- Google Maps                            -> cmd-shift-s: Sentry
}) do
  hl.unbind(keys)
end

-- Herdr's own (keys/herdr.linux.json)
for _, keys in ipairs({
  "SUPER + W",                 -- Close window (SUPER + Q still does)    -> cmd-w: close the tab
  "SUPER + T",                 -- Toggle floating/tiling                 -> cmd-t: new tab
  "SUPER + P",                 -- Pseudo window                          -> cmd-p: picker
  "SUPER + SHIFT + D",         -- Docker                                 -> cmd-shift-d: split down
  "SUPER + SHIFT + W",         -- Omawrite                               -> cmd-shift-w: close the pane
  "SUPER + SHIFT + RETURN",    -- Browser (SUPER + SHIFT + B still does) -> cmd-shift-enter: zoom the pane
  "SUPER + ALT + LEFT",        -- Move window to group on the left       -> cmd-alt-left: go to the left pane
  "SUPER + ALT + RIGHT",       -- ... on the right                       -> cmd-alt-right
  "SUPER + ALT + UP",          -- ... on top                             -> cmd-alt-up
  "SUPER + ALT + DOWN",        -- ... on the bottom                      -> cmd-alt-down
  "SUPER + ALT + code:34",     -- Webcam overlay smaller                 -> cmd-alt-[: previous space
  "SUPER + ALT + code:35",     -- Webcam overlay larger                  -> cmd-alt-]: next space
}) do
  hl.unbind(keys)
end
