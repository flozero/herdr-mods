export function saveTemplate(list, name, text) {
  const n = String(name ?? "").trim();
  if (!n || !String(text ?? "").trim()) return list;
  const at = list.findIndex((x) => x.name.toLowerCase() === n.toLowerCase());
  const entry = { name: n, text };
  return at < 0 ? [...list, entry] : list.map((x, i) => (i === at ? entry : x));
}

export const deleteTemplate = (list, name) => list.filter((x) => x.name !== name);

export const worktreeChoices = (choices) => choices.filter((c) => c.kind === "worktree");

export function startTask(prompt, base) {
  const p = String(prompt ?? "").trim();
  return p ? `${p}\n\n${base}` : base;
}
