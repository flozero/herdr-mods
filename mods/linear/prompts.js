// Where to work: the tabs and checkouts already on the issue, and a new worktree only in the
// parent repo (made with `fallback` when the scan didn't list it), not in every repo around.
export function parentChoices(choices, parent, fallback) {
  const others = choices.filter((c) => c.kind !== "worktree");
  if (!parent) return others;
  const mine = choices.find((c) => c.kind === "worktree" && c.folder === parent.folder) ?? fallback;
  return [...others, mine].sort((a, b) => b.rank - a.rank);
}
