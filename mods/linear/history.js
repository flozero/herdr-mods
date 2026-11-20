const name = (u) => u?.displayName ?? u?.name ?? null;
const whoOf = (n) => name(n.actor) ?? n.botActor?.name ?? null;
const sameTime = (a, b) => Math.abs(Date.parse(a ?? "") - Date.parse(b ?? "")) < 2000;

export function createdBy(issue, nodes) {
  const first = [...(nodes ?? [])].find((n) => sameTime(n.createdAt, issue.createdAt));
  return name(issue.creator) ?? (first ? whoOf(first) : null);
}

function changes(n, tr) {
  const out = [];
  if (n.fromState || n.toState) out.push(tr.state(n.fromState?.name ?? "?", n.toState?.name ?? "?"));
  if (n.toAssignee) out.push(tr.assigned(name(n.toAssignee)));
  else if (n.fromAssignee) out.push(tr.unassigned(name(n.fromAssignee)));
  for (const l of n.addedLabels ?? []) out.push(tr.labelAdded(l.name));
  for (const l of n.removedLabels ?? []) out.push(tr.labelRemoved(l.name));
  if (n.fromPriority != null || n.toPriority != null) out.push(tr.priority(tr.priorityName[n.fromPriority ?? 0], tr.priorityName[n.toPriority ?? 0]));
  if (n.toTitle) out.push(tr.renamed(n.toTitle));
  if (n.fromParent || n.toParent) out.push(tr.parent(n.fromParent?.identifier ?? null, n.toParent?.identifier ?? null));
  if (n.fromProject || n.toProject) out.push(tr.project(n.fromProject?.name ?? null, n.toProject?.name ?? null));
  if (n.fromCycle || n.toCycle) out.push(tr.cycle(n.fromCycle?.number ?? null, n.toCycle?.number ?? null));
  if (n.fromDueDate || n.toDueDate) out.push(tr.due(n.fromDueDate ?? null, n.toDueDate ?? null));
  if (n.fromEstimate != null || n.toEstimate != null) out.push(tr.estimate(n.fromEstimate ?? null, n.toEstimate ?? null));
  if (n.archived) out.push(tr.archived);
  if (n.trashed) out.push(tr.trashed);
  return out;
}

export function historyEntries(issue, nodes, tr) {
  return [...(nodes ?? [])]
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((n) => {
      const parts = changes(n, tr);
      const text = parts.length ? parts.join(" · ") : sameTime(n.createdAt, issue.createdAt) ? tr.created : null;
      return text ? { at: n.createdAt, who: whoOf(n) ?? tr.someone, text } : null;
    })
    .filter(Boolean);
}
