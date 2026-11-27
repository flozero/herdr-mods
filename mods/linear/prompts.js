export function saveTemplate(list, name, text) {
  const n = String(name ?? "").trim();
  if (!n || !String(text ?? "").trim()) return list;
  const at = list.findIndex((x) => x.name.toLowerCase() === n.toLowerCase());
  const entry = { name: n, text };
  return at < 0 ? [...list, entry] : list.map((x, i) => (i === at ? entry : x));
}

export const deleteTemplate = (list, name) => list.filter((x) => x.name !== name);

// Where to work: the tabs and checkouts already on the issue, and a new worktree only in the
// parent repo (made with `fallback` when the scan didn't list it), not in every repo around.
export function parentChoices(choices, parent, fallback) {
  const others = choices.filter((c) => c.kind !== "worktree");
  if (!parent) return others;
  const mine = choices.find((c) => c.kind === "worktree" && c.folder === parent.folder) ?? fallback;
  return [...others, mine].sort((a, b) => b.rank - a.rank);
}

export function startTask(prompt, base) {
  const p = String(prompt ?? "").trim();
  return p ? `${p}\n\n${base}` : base;
}
