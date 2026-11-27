export const PAGE_SIZE = 50;
const COMMENT_PAGE_SIZE = 100;
const FINISHED = ["completed", "canceled", "duplicate"];
const OPEN = ["triage", "backlog", "unstarted", "started"];
const STATE_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate"];
const STATE_COLOR = { triage: "#fc7840", backlog: "#bec2c8", unstarted: "#e2e2e2", started: "#f2c94c", completed: "#5e6ad2", canceled: "#95a2b3", duplicate: "#95a2b3" };

export class ApiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

let runner = async () => { throw new ApiError("auth", "not connected"); };

export function setRunner(fn) {
  runner = fn;
}

export function errorKind(message) {
  const m = String(message ?? "");
  if (/not connected|session expired|refused the session|linear-me login|HTTP 401|unauthori[sz]ed|invalid_grant|invalid refresh token/i.test(m)) return "auth";
  if (/rate ?limit|HTTP 429/i.test(m)) return "ratelimit";
  if (/could not find|not found/i.test(m)) return "notfound";
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timed? ?out/i.test(m)) return "network";
  return "graphql";
}

const SERIOUS = ["auth", "ratelimit", "network"];

async function run(calls) {
  let out;
  try { out = await runner(calls); }
  catch (e) { throw e instanceof ApiError ? e : new ApiError(errorKind(e?.message ?? e), String(e?.message ?? e)); }
  const failed = out.find((r) => !r.ok && SERIOUS.includes(errorKind(r.error)));
  if (failed) throw new ApiError(errorKind(failed.error), failed.error);
  return out;
}

async function one(tool, args) {
  const [r] = await run([{ tool, args }]);
  if (!r.ok) throw new ApiError(errorKind(r.error), r.error);
  return r.value;
}

const valueOr = (r, fallback) => (r?.ok ? r.value : fallback);

export const stateColor = (type) => STATE_COLOR[type] ?? STATE_COLOR.unstarted;

export function stateOf(name, type, id = null) {
  if (!name && !type) return null;
  return { id, name: name ?? "", type: type ?? "unstarted", color: stateColor(type), position: STATE_ORDER.indexOf(type) };
}

const keyOf = (identifier) => String(identifier ?? "").split("-")[0];
const numberOf = (identifier) => Number(String(identifier ?? "").split("-")[1]) || null;
const person = (id, name) => (id || name ? { id: id ?? null, name: name ?? "", displayName: name ?? "" } : null);
const related = (r) => (r?.id ? { id: r.id, identifier: r.id, title: r.title ?? "", state: null } : null);

export function prMetadata(issue) {
  const type = issue?.statusType;
  return { status: type === "completed" ? "merged" : type === "canceled" || type === "duplicate" ? "closed" : null };
}

export function issueOf(m) {
  if (!m?.id) return null;
  const labels = (m.labels ?? []).map((l) => (typeof l === "string" ? { id: l, name: l, color: null } : { id: l.id ?? l.name, name: l.name, color: l.color ?? null }));
  const issue = {
    id: m.uuid ?? m.id, identifier: m.id, number: numberOf(m.id), title: m.title ?? "", description: m.description ?? null,
    priority: typeof m.priority === "object" ? m.priority?.value ?? 0 : m.priority ?? 0, url: m.url ?? null, branchName: m.gitBranchName ?? null,
    dueDate: m.dueDate ?? null, createdAt: m.createdAt ?? null, updatedAt: m.updatedAt ?? null, archivedAt: m.archivedAt ?? null, trashed: false,
    team: { id: m.teamId ?? null, key: keyOf(m.id), name: m.team ?? keyOf(m.id) },
    state: stateOf(m.status, m.statusType),
    assignee: person(m.assigneeId, m.assignee),
    project: m.projectId || m.project ? { id: m.projectId ?? null, name: m.project ?? "" } : null,
    cycle: m.cycleId ? { id: m.cycleId, number: null, name: null } : null,
    parent: m.parentId ? { id: m.parentId, identifier: m.parentId, title: null, state: null } : null,
    labels: { nodes: labels },
  };
  if (Array.isArray(m.attachments)) {
    issue.attachments = { nodes: m.attachments.map((a) => ({ url: a.url, sourceType: null, createdAt: a.createdAt ?? "", metadata: prMetadata(m) })) };
  }
  return issue;
}

const issuesOf = (v) => (v?.issues ?? []).map(issueOf).filter(Boolean);
const pageOf = (v) => ({ nodes: issuesOf(v), pageInfo: { hasNextPage: Boolean(v?.hasNextPage), endCursor: v?.cursor ?? null } });

export function commentOf(c) {
  return {
    id: c.id, body: c.body ?? "", createdAt: c.createdAt, editedAt: c.updatedAt && c.updatedAt !== c.createdAt ? c.updatedAt : null,
    parent: c.parentId ? { id: c.parentId } : null, reactionData: [], user: person(c.author?.id, c.author?.name),
  };
}

export function historyOf(stateHistory) {
  const list = [...(stateHistory ?? [])].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  return list.slice(1).map((h, i) => ({ createdAt: h.startedAt, fromState: { name: list[i].state?.name ?? "?" }, toState: { name: h.state?.name ?? "?" } }));
}

export async function people() {
  const v = await one("list_users", { limit: 250 });
  return (v?.users ?? []).filter((u) => u.isActive !== false).map((u) => ({ id: u.id, name: u.name, displayName: u.displayName ?? u.name }));
}

export function viewerOf(who, user, teams) {
  if (!who?.user?.id) return null;
  const url = String(who.workspace?.url ?? "").replace(/\/+$/, "");
  return {
    id: who.user.id, name: who.user.name, displayName: who.user.displayName ?? who.user.name, email: who.user.email ?? null,
    teams: { nodes: (user?.teams ?? []).map((t) => ({ id: t.id, key: t.key, name: t.name })) },
    organization: { id: who.workspace?.id ?? null, name: who.workspace?.name ?? "", urlKey: url.split("/").pop() || null },
    teamKeys: (teams?.teams ?? []).map((t) => t.key),
  };
}

export async function viewer() {
  const [who, user, teams] = await run([{ tool: "whoami" }, { tool: "get_user", args: { query: "me" } }, { tool: "list_teams", args: { limit: 250 } }]);
  if (!who.ok) throw new ApiError(errorKind(who.error), who.error);
  return viewerOf(who.value, valueOr(user, null), valueOr(teams, null));
}

const byUpdated = (list) => {
  const seen = new Map();
  for (const i of list) if (!seen.has(i.id)) seen.set(i.id, i);
  return [...seen.values()].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
};

export async function myIssues() {
  const out = await run(OPEN.map((state) => ({ tool: "list_issues", args: { assignee: "me", state, limit: PAGE_SIZE, orderBy: "updatedAt" } })));
  return byUpdated(out.flatMap((r) => issuesOf(valueOr(r, null)))).filter((i) => !FINISHED.includes(i.state?.type));
}

export async function teamIssues(teamIds, after) {
  let cursors = null;
  try { cursors = after ? JSON.parse(after) : null; } catch {}
  const teams = (teamIds.length ? teamIds : [""]).filter((t) => !cursors || cursors[t]);
  const limit = Math.ceil(PAGE_SIZE / Math.max(1, teamIds.length));
  const out = await run(teams.map((team) => ({ tool: "list_issues",
    args: { limit, orderBy: "updatedAt", ...(team ? { team } : {}), ...(cursors ? { cursor: cursors[team] } : {}) } })));
  const next = {};
  teams.forEach((team, n) => { const v = valueOr(out[n], null); if (v?.hasNextPage && v.cursor) next[team] = v.cursor; });
  const more = Object.keys(next).length > 0;
  return { nodes: byUpdated(out.flatMap((r) => issuesOf(valueOr(r, null)))), pageInfo: { hasNextPage: more, endCursor: more ? JSON.stringify(next) : null } };
}

export async function searchIssues(calls) {
  if (!calls.length) return [];
  const out = await run(calls);
  return byUpdated(out.flatMap((r) => {
    const v = valueOr(r, null);
    return v?.issues ? issuesOf(v) : [issueOf(v)].filter(Boolean);
  }));
}

export function issuesById(ids) {
  return searchIssues(ids.map((id) => ({ tool: "get_issue", args: { id } })));
}

export function detailOf(m, comments, children) {
  const issue = issueOf(m);
  if (!issue) return null;
  issue.reactionData = [];
  issue.creator = person(m.createdById, m.createdBy);
  const rel = m.relations ?? null;
  const relations = {
    children: issuesOf(children),
    moreChildren: Boolean(children?.hasNextPage),
    blocking: (rel?.blocks ?? []).map(related).filter(Boolean),
    blockedBy: (rel?.blockedBy ?? []).map(related).filter(Boolean),
    related: [...(rel?.relatedTo ?? []), ...(rel?.duplicateOf ? [rel.duplicateOf] : [])].map(related).filter(Boolean),
  };
  const list = (comments?.comments ?? []).map(commentOf).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { issue, comments: list, history: historyOf(m.stateHistory), moreComments: Boolean(comments?.hasNextPage), relations, at: Date.now() };
}

export async function issueDetail(id) {
  const [issue, comments, children] = await run([
    { tool: "get_issue", args: { id, includeRelations: true } },
    { tool: "list_comments", args: { issueId: id, limit: COMMENT_PAGE_SIZE } },
    { tool: "list_issues", args: { parentId: id, limit: PAGE_SIZE } },
  ]);
  if (!issue.ok) {
    if (errorKind(issue.error) === "notfound") return null;
    throw new ApiError(errorKind(issue.error), issue.error);
  }
  return detailOf(issue.value, valueOr(comments, null), valueOr(children, null));
}

function prNumber(url) {
  for (const m of ["/pull/", "/merge_requests/"]) {
    const rest = String(url ?? "").split(m)[1];
    if (rest) { const n = parseInt(rest.split(/[/?#]/)[0], 10); if (!isNaN(n)) return n; }
  }
  return null;
}

function reviewState(reviews) {
  const last = new Map();
  for (const r of [...(reviews ?? [])].sort((a, b) => String(a.submittedAt ?? "").localeCompare(String(b.submittedAt ?? "")))) {
    const st = String(r.state ?? "").toLowerCase();
    const who = r.reviewerId ?? r.reviewerLogin ?? "?";
    if (st === "approved" || st === "changes_requested") last.set(who, st);
    else if (st === "dismissed") last.delete(who);
  }
  const all = [...last.values()];
  return all.includes("changes_requested") ? "changes" : all.includes("approved") ? "approved" : null;
}

export function prs(issue) {
  const rank = { open: 0, draft: 1, merged: 2, closed: 3 };
  return (issue?.attachments?.nodes ?? [])
    .filter((a) => prNumber(a.url) !== null)
    .map((a) => {
      const m = a.metadata ?? {};
      const raw = String(m.status ?? "").toLowerCase();
      const status = raw === "merged" || m.mergedAt ? "merged"
        : raw === "closed" || m.closedAt ? "closed"
        : m.draft || raw === "draft" ? "draft" : "open";
      return {
        url: a.url, number: typeof m.number === "number" ? m.number : prNumber(a.url), repo: m.repoName ?? null,
        status, draft: status === "draft", review: status === "open" || status === "draft" ? reviewState(m.reviews) : null,
        conflicts: (status === "open" || status === "draft") && m.hasConflicts === true, at: a.createdAt ?? "",
      };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || b.at.localeCompare(a.at));
}

export function mainPr(issue) {
  return prs(issue)[0] ?? null;
}

export function openPr(issue) {
  const p = mainPr(issue);
  return p && (p.status === "open" || p.status === "draft") ? p : null;
}

export function statesOf(list) {
  return (list ?? []).map((s, n) => ({ state: stateOf(s.name, s.type, s.id), n }))
    .sort((a, b) => a.state.position - b.state.position || a.n - b.n)
    .map(({ state }, position) => ({ ...state, position }));
}

export async function teamStates(teamId) {
  return statesOf(await one("list_issue_statuses", { team: teamId }));
}

export function viewSlug(text) {
  const t = String(text ?? "").trim();
  return /linear\.app\/[^/]+\/view\/(?:[^/?#]*-)?([0-9a-f]{12})(?:[/?#]|$)/i.exec(t)?.[1] ?? (/^[0-9a-f]{12}$/i.test(t) ? t : null);
}

export function viewOf(views, slug) {
  const v = (views ?? []).find((x) => x.id === slug || String(x.url ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "").endsWith(slug));
  return v ? { id: v.id, slugId: slug, name: v.name, color: v.color ?? null, shared: v.shared ?? true, modelName: v.modelName ?? "Issue", updatedAt: v.updatedAt ?? null, team: v.team ?? null } : null;
}

export async function customView(slug) {
  let cursor = null;
  for (let n = 0; n < 5; n++) {
    const v = await one("list_custom_views", { limit: 100, ...(cursor ? { cursor } : {}) });
    const found = viewOf(v?.customViews, slug);
    if (found) return found;
    if (!v?.hasNextPage || !v.cursor) break;
    cursor = v.cursor;
  }
  const [probe] = await run([{ tool: "list_issues", args: { customView: slug, limit: 1 } }]);
  return probe.ok ? { id: slug, slugId: slug, name: slug, color: null, shared: true, modelName: "Issue", updatedAt: null, team: null } : null;
}

export function projectSlug(text) {
  return /linear\.app\/[^/]+\/project\/(?:[^/?#]*-)?([0-9a-f]{12})(?:[/?#]|$)/i.exec(String(text ?? "").trim())?.[1] ?? null;
}

export async function project(slug) {
  try {
    const p = await one("get_project", { query: slug });
    return p?.id ? { id: p.uuid ?? p.id, slugId: slug, name: p.name, color: p.color ?? null, kind: "project", shared: true, team: null, modelName: "Issue" } : null;
  } catch (e) {
    if (e.kind === "notfound") return null;
    throw e;
  }
}

export function viewItem(v) {
  if (v?.kind === "view") return v;
  return { id: v.id, slugId: v.slugId ?? null, name: v.name ?? "", color: v.color ?? null, kind: "view", shared: v.shared ?? true, modelName: "Issue",
    team: v.team ? { id: v.team.id ?? null, key: v.team.key ?? null, name: v.team.name ?? null } : null, url: v.url ?? null };
}

export async function customViews() {
  const out = [];
  let cursor = null;
  for (let n = 0; n < 4; n++) {
    const v = await one("list_custom_views", { type: "Issue", limit: 250, ...(cursor ? { cursor } : {}) });
    out.push(...(v?.customViews ?? []).filter((x) => x?.id && (x.modelName ?? "Issue") === "Issue").map(viewItem));
    if (!v?.hasNextPage || !v.cursor) break;
    cursor = v.cursor;
  }
  return out;
}

export function projectOf(p) {
  if (p?.kind === "project") return p;
  return { id: p.uuid ?? p.id, slugId: p.slugId ?? null, name: p.name ?? "", color: p.color ?? null, kind: "project", shared: true, team: null, modelName: "Issue",
    status: p.status ? { name: p.status.name, type: p.status.type } : null, teams: (p.teams ?? []).map((t) => t.key).filter(Boolean), url: p.url ?? null };
}

export async function projects(query, after = null) {
  const v = await one("list_projects", { limit: PAGE_SIZE, orderBy: "updatedAt", ...(query ? { query } : {}), ...(after ? { cursor: after } : {}),
    fields: ["id", "uuid", "name", "status", "teams", "url", "updatedAt"] });
  return { nodes: (v?.projects ?? []).filter((p) => p?.id).map(projectOf), cursor: v?.cursor ?? null, more: Boolean(v?.hasNextPage) };
}

export function overviewOf(p, updates, comments) {
  if (!p) return null;
  const nodes = (list) => ({ nodes: list ?? [] });
  const posts = updates?.statusUpdates ?? [];
  return {
    id: p.uuid ?? p.id, name: p.name, content: p.description ?? null, description: p.summary ?? null, url: p.url ?? null, progress: null,
    startDate: p.startDate ?? null, targetDate: p.targetDate ?? null, health: posts[0]?.health ?? null,
    status: p.status ? { name: p.status.name, type: p.status.type, color: p.color ?? null } : null,
    lead: p.lead ?? null,
    teams: nodes((p.teams ?? []).map((t) => ({ key: t.key, name: t.name }))),
    members: nodes((p.members ?? []).map((m) => ({ id: m.id, name: m.name }))),
    projectMilestones: nodes((p.milestones ?? []).map((m) => ({ id: m.id, name: m.name, targetDate: m.targetDate ?? null }))),
    projectUpdates: nodes(posts.map((u) => ({ id: u.id, body: u.body ?? "", health: u.health ?? null, createdAt: u.createdAt, user: { name: u.user?.name ?? "" } }))),
    comments: nodes((comments?.comments ?? []).map((c) => ({ id: c.id, body: c.body ?? "", createdAt: c.createdAt, user: { name: c.author?.name ?? "" } }))),
    history: nodes([]),
  };
}

export async function projectOverview(id) {
  const [p, updates, comments] = await run([
    { tool: "get_project", args: { query: id, includeMilestones: true, includeMembers: true } },
    { tool: "get_status_updates", args: { type: "project", project: id, limit: 20 } },
    { tool: "list_comments", args: { projectId: id, limit: 30 } },
  ]);
  if (!p.ok) {
    if (errorKind(p.error) === "notfound") return null;
    throw new ApiError(errorKind(p.error), p.error);
  }
  return overviewOf(p.value, valueOr(updates, null), valueOr(comments, null));
}

export async function projectIssues(id, after = null) {
  return pageOf(await one("list_issues", { project: id, limit: PAGE_SIZE, orderBy: "updatedAt", ...(after ? { cursor: after } : {}) }));
}

export async function viewIssues(viewId, after = null) {
  return pageOf(await one("list_issues", { customView: viewId, limit: PAGE_SIZE, ...(after ? { cursor: after } : {}) }));
}

// A team's labels that can go on an issue (no groups, nothing retired or archived).
export function labelsOf(v) {
  return (v?.labels ?? []).filter((l) => l?.id && !l.isGroup && !l.retiredAt && !l.archivedAt)
    .map((l) => ({ id: l.id, name: l.name ?? "", color: l.color ?? null, group: l.parent ?? null }))
    .sort((a, b) => String(a.group ?? "").localeCompare(String(b.group ?? "")) || a.name.localeCompare(b.name));
}

export async function teamLabels(teamId) {
  return labelsOf(await one("list_issue_labels", { team: teamId, limit: 250 }));
}

// The cycles still to come or running, soonest first.
export function cyclesOf(v, now = Date.now()) {
  const list = Array.isArray(v) ? v : v?.cycles ?? [];
  return list.filter((c) => c?.id && (c.isCurrent || !c.endsAt || Date.parse(c.endsAt) >= now))
    .map((c) => ({ id: c.id, number: c.number ?? null, name: c.title || c.name || null, startsAt: c.startsAt ?? null, endsAt: c.endsAt ?? null, current: Boolean(c.isCurrent) }))
    .sort((a, b) => String(a.startsAt ?? "").localeCompare(String(b.startsAt ?? "")));
}

export async function teamCycles(teamId) {
  return cyclesOf(await one("list_cycles", { teamId }));
}
