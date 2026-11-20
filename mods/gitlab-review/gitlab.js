import { exec, appHome } from "herdr";
import * as fs from "fs/promises";
import { position } from "./diff.js";
import { parsePages } from "./pages.js";


const cacheDir = () => `${appHome()}/mods/gitlab-review/.cache`;

async function glab(cwd, args) {
  const r = await exec("glab", args, { cwd });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || "").trim().split("\n").pop() || `glab exited with ${r.code}`);
  return r.stdout;
}

const parsed = (text) => (text.trim() ? JSON.parse(text) : null);
const get = async (cwd, path) => JSON.parse(await glab(cwd, ["api", path]));
const all = async (cwd, path) => parsePages(await glab(cwd, ["api", "--paginate", path]));

async function send(cwd, method, path, body = {}) {
  const dir = cacheDir();
  await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", dir]);
  const file = `${dir}/body-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  await fs.writeFile(file, JSON.stringify(body));
  try {
    return parsed(await glab(cwd, ["api", "-X", method, "-H", "Content-Type: application/json", "--input", file, path]));
  } finally {
    await exec("rm", ["-f", file]).catch(() => {});
  }
}

async function graphql(cwd, query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`, ...Object.entries(variables).flatMap(([k, v]) => ["-f", `${k}=${v}`])];
  const d = JSON.parse(await glab(cwd, args));
  if (d.errors?.length) throw new Error(d.errors.map((e) => e.message).join("; "));
  return d.data;
}

const mrPath = (iid) => `projects/:id/merge_requests/${iid}`;

export const project = (cwd) => get(cwd, "projects/:id");
export const me = (cwd) => get(cwd, "user");
export const reviewing = (cwd, username) =>
  all(cwd, `projects/:id/merge_requests?state=opened&reviewer_username=${encodeURIComponent(username)}&order_by=updated_at&per_page=100`);
export const mergeRequest = (cwd, iid) => get(cwd, mrPath(iid));
export const forBranch = (cwd, branch) =>
  get(cwd, `projects/:id/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`);
export const diffs = (cwd, iid) => all(cwd, `${mrPath(iid)}/diffs?per_page=100`);
export const discussions = (cwd, iid) => all(cwd, `${mrPath(iid)}/discussions?per_page=100`);
export const approvals = (cwd, iid) => get(cwd, `${mrPath(iid)}/approvals`);
export const drafts = (cwd, iid) => all(cwd, `${mrPath(iid)}/draft_notes?per_page=100`);

export const comment = (cwd, iid, body) => send(cwd, "POST", `${mrPath(iid)}/notes`, { body });
export const discussion = (cwd, iid, body, position) => send(cwd, "POST", `${mrPath(iid)}/discussions`, { body, position });
export const reply = (cwd, iid, discussionId, body) => send(cwd, "POST", `${mrPath(iid)}/discussions/${discussionId}/notes`, { body });
export const lineComment = (cwd, iid, refs, file, row, body, from = null) =>
  send(cwd, "POST", `${mrPath(iid)}/discussions`, { body, position: position(refs, file, row, from) });

export const addDraft = (cwd, iid, draft) => send(cwd, "POST", `${mrPath(iid)}/draft_notes`, draft);
export const deleteDraft = (cwd, iid, id) => send(cwd, "DELETE", `${mrPath(iid)}/draft_notes/${id}`);
export const publishDrafts = (cwd, iid) => send(cwd, "POST", `${mrPath(iid)}/draft_notes/bulk_publish`);

export const setState = (cwd, iid, event) => send(cwd, "PUT", mrPath(iid), { state_event: event });
export const raw = (cwd, path, ref) =>
  glab(cwd, ["api", `projects/:id/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`]);
export const setDescription = (cwd, iid, description) => send(cwd, "PUT", mrPath(iid), { description });
export const approve = (cwd, iid) => send(cwd, "POST", `${mrPath(iid)}/approve`);
export const unapprove = (cwd, iid) => send(cwd, "POST", `${mrPath(iid)}/unapprove`);

export async function setDraft(cwd, projectPath, iid, draft) {
  const d = await graphql(cwd, `mutation($p: ID!, $i: String!) { mergeRequestSetDraft(input: { projectPath: $p, iid: $i, draft: ${draft ? "true" : "false"} }) { errors } }`,
    { p: projectPath, i: String(iid) });
  const errors = d.mergeRequestSetDraft?.errors ?? [];
  if (errors.length) throw new Error(errors.join("; "));
}

export async function setPeople(cwd, projectPath, iid, kind, usernames, mode) {
  const [mutation, field] = kind === "reviewers" ? ["mergeRequestSetReviewers", "reviewerUsernames"] : ["mergeRequestSetAssignees", "assigneeUsernames"];
  const d = await graphql(cwd, `mutation($p: ID!, $i: String!) { ${mutation}(input: { projectPath: $p, iid: $i, ${field}: ${JSON.stringify(usernames)}, operationMode: ${mode} }) { errors } }`,
    { p: projectPath, i: String(iid) });
  const errors = d[mutation]?.errors ?? [];
  if (errors.length) throw new Error(errors.join("; "));
}

export const users = (cwd, search) => get(cwd, `projects/:id/users?per_page=20&search=${encodeURIComponent(search)}`);

export async function requestChanges(cwd, projectPath, iid) {
  const d = await graphql(cwd, "mutation($p: ID!, $i: String!) { mergeRequestRequestChanges(input: { projectPath: $p, iid: $i }) { errors } }",
    { p: projectPath, i: String(iid) });
  const errors = d.mergeRequestRequestChanges?.errors ?? [];
  if (errors.length) throw new Error(errors.join("; "));
}

export async function reviewState(cwd, projectPath, iid, username) {
  const d = await graphql(cwd, "query($p: ID!, $i: String!) { project(fullPath: $p) { mergeRequest(iid: $i) { reviewers { nodes { username mergeRequestInteraction { reviewState } } } } } }",
    { p: projectPath, i: String(iid) });
  const nodes = d.project?.mergeRequest?.reviewers?.nodes ?? [];
  return nodes.find((n) => n.username === username)?.mergeRequestInteraction?.reviewState ?? null;
}

export async function sidebar(cwd, projectPath, iid) {
  const d = await graphql(cwd, `query($p: ID!, $i: String!) { project(fullPath: $p) { mergeRequest(iid: $i) {
    assignees { nodes { username name } }
    reviewers { nodes { username name mergeRequestInteraction { reviewState approved } } }
    participants { nodes { username name } }
    labels { nodes { title color textColor description } }
    milestone { title dueDate }
    approvalsLeft approvalsRequired
  } } }`, { p: projectPath, i: String(iid) });
  const m = d.project?.mergeRequest;
  if (!m) return null;
  return {
    assignees: m.assignees?.nodes ?? [],
    reviewers: (m.reviewers?.nodes ?? []).map((r) => ({ username: r.username, name: r.name, state: r.mergeRequestInteraction?.reviewState ?? null, approved: Boolean(r.mergeRequestInteraction?.approved) })),
    participants: m.participants?.nodes ?? [],
    labels: m.labels?.nodes ?? [],
    milestone: m.milestone ?? null,
    approvalsLeft: m.approvalsLeft ?? null,
    approvalsRequired: m.approvalsRequired ?? null,
  };
}

export const compare = (cwd, from, to) =>
  get(cwd, `projects/:id/repository/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&straight=true`);

export async function reviewSummary(cwd, projectPath, iids, username) {
  if (!iids.length) return {};
  const list = iids.map((i) => `"${Number(i)}"`).join(",");
  const d = await graphql(cwd, `query($p: ID!) { project(fullPath: $p) { mergeRequests(iids: [${list}], first: 100) { nodes {
    iid commenters { nodes { username } } reviewers { nodes { username mergeRequestInteraction { reviewState approved } } } } } } }`, { p: projectPath });
  return Object.fromEntries((d.project?.mergeRequests?.nodes ?? []).map((n) => {
    const me = (n.reviewers?.nodes ?? []).find((r) => r.username === username)?.mergeRequestInteraction;
    return [n.iid, {
      approved: Boolean(me?.approved),
      state: me?.reviewState ?? null,
      commented: (n.commenters?.nodes ?? []).some((c) => c.username === username),
    }];
  }));
}

export const authored = (cwd, username) =>
  all(cwd, `projects/:id/merge_requests?state=opened&author_username=${encodeURIComponent(username)}&order_by=updated_at&per_page=100`);

export async function mrStatus(cwd, projectPath, iids) {
  if (!iids.length) return {};
  const list = iids.map((i) => `"${Number(i)}"`).join(",");
  const d = await graphql(cwd, `query($p: ID!) { project(fullPath: $p) { mergeRequests(iids: [${list}], first: 100) { nodes {
    iid headPipeline { status } approved approvalsLeft approvedBy { nodes { username } } conflicts } } } }`, { p: projectPath });
  return Object.fromEntries((d.project?.mergeRequests?.nodes ?? []).map((n) => [n.iid, {
    pipeline: n.headPipeline?.status?.toLowerCase() ?? null,
    approved: Boolean(n.approved),
    left: n.approvalsLeft ?? 0,
    by: (n.approvedBy?.nodes ?? []).map((u) => u.username),
    conflicts: Boolean(n.conflicts),
  }]));
}

export const merged = (cwd, username) =>
  get(cwd, `projects/:id/merge_requests?state=merged&reviewer_username=${encodeURIComponent(username)}&order_by=merged_at&sort=desc&per_page=30`);

export const commits = (cwd, iid) => all(cwd, `projects/:id/merge_requests/${iid}/commits?per_page=100`);
