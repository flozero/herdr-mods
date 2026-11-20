const DATE = { startDate: "the start date", targetDate: "the target date" };
const SKIP = new Set(["icon", "color", "leadTeamId"]);

export function projectEvents(project, people = {}) {
  const who = (id) => people[id] ?? "Someone";
  const milestone = new Map((project?.projectMilestones?.nodes ?? []).map((m) => [m.id, m.name]));
  const names = (ids) => (ids ?? []).map((x) => (typeof x === "string" ? people[x] : milestone.get(x.id) || x.name)).filter(Boolean);
  const out = [];
  for (const h of project?.history?.nodes ?? []) {
    for (const e of h.entries ?? []) {
      if (SKIP.has(e.type)) continue;
      const at = e.at ? new Date(e.at).toISOString() : h.createdAt;
      const by = who(e.actorId ?? e.actorIds?.[0]);
      let text;
      if (e.type === "status") text = `moved it from ${e.fromStatus?.name ?? "?"} to ${e.toStatus?.name ?? "?"}`;
      else if (DATE[e.type]) text = e.to ? `set ${DATE[e.type]} to ${e.to}` : `cleared ${DATE[e.type]}`;
      else if (e.type === "leadId") text = e.to ? `made ${who(e.to)} lead` : "removed the lead";
      else if (e.type === "name") text = `renamed it from “${e.from}” to “${e.to}”`;
      else if (e.type === "content" || e.type === "description") text = "edited the description";
      else if (e.type === "milestone_completion") text = `completed the milestone ${milestone.get(e.milestone?.id) || e.milestone?.name || ""}`.trim();
      else if (["members", "milestones", "teams", "labels", "initiatives", "relations"].includes(e.type)) {
        const added = names(e.added), removed = names(e.removed);
        const n = (e.added?.length ?? 0) + (e.removed?.length ?? 0);
        const word = e.type === "milestones" ? "milestone" : e.type === "members" ? "member" : e.type.replace(/s$/, "");
        text = added.length || removed.length
          ? [added.length && `added ${added.join(", ")}`, removed.length && `removed ${removed.join(", ")}`].filter(Boolean).join(", ") + (e.type === "members" ? "" : ` (${word}${n > 1 ? "s" : ""})`)
          : `changed the ${e.type}`;
      } else text = `changed ${e.type}`;
      out.push({ kind: "event", at, who: by, text });
    }
  }
  for (const u of project?.projectUpdates?.nodes ?? []) out.push({ kind: "update", at: u.createdAt, who: u.user?.name ?? "Someone", health: u.health ?? null, body: u.body ?? "" });
  for (const c of project?.comments?.nodes ?? []) out.push({ kind: "comment", at: c.createdAt, who: c.user?.name ?? "Someone", body: c.body ?? "" });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
