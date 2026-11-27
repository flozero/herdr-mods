// Stacks as a tree: a merge request goes under the one of the list whose branch it targets.
// Gives the rows shown, in order, with their depth and how many are stacked on each; a folded
// parent hides what is stacked on it. A top row that targets another branch than the base keeps
// it in stackedOn (its parent isn't in the list).
export function stackTree(rows, folded, base) {
  const bySource = new Map(rows.map((x) => [x.m.source_branch, x]));
  const parentOf = (x) => { const p = x.m.target_branch ? bySource.get(x.m.target_branch) : null; return p && p !== x ? p : null; };
  const kids = new Map();
  for (const x of rows) { const p = parentOf(x); if (p) kids.set(p.m.iid, [...(kids.get(p.m.iid) ?? []), x]); }
  const out = [], reached = new Set();
  const walk = (x, depth, hidden) => {
    if (reached.has(x.m.iid)) return;
    reached.add(x.m.iid);
    const under = kids.get(x.m.iid) ?? [];
    const shut = folded.has(x.m.iid);
    const stackedOn = depth === 0 && x.m.target_branch && x.m.target_branch !== base ? x.m.target_branch : null;
    if (!hidden) out.push({ ...x, depth, kids: under.length, folded: shut, stackedOn });
    for (const c of under) walk(c, depth + 1, hidden || shut);
  };
  for (const x of rows) if (!parentOf(x)) walk(x, 0, false);
  for (const x of rows) walk(x, 0, false);
  return out;
}
