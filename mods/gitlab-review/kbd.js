// The hints are written for macOS, where ⌘↵ sends. Elsewhere ⌘ is Super, and Super+Enter starts the terminal on
// Omarchy and most desktops, so the mods also take ctrl-enter and the hint says ⌃↵. Every other chord is the
// same on both (cmd-r is Super+R). keyLabels(text, window().platform); the platform is null without a window.
export function keyLabels(text, platform) {
  if (!platform || platform === "macos" || typeof text !== "string") return text;
  return text.replace(/⌘(↵|Enter)/g, "⌃$1");
}
