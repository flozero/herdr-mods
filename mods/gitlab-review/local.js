import { splitGitDiff, parseDiff } from "./diff.js";

const lineOf = (end) => end?.new_line ?? end?.old_line;
const sign = (r) => (r.kind === "add" ? "+" : r.kind === "del" ? "-" : " ");

export function noteLines(p) {
  if (!p) return null;
  const path = p.new_path ?? p.old_path;
  const end = p.new_line ?? p.old_line;
  const start = p.line_range ? lineOf(p.line_range.start) : end;
  return start != null && start !== end ? `${path}:${start}-${end}` : `${path}:${end}`;
}

function rowsFor(p, files) {
  const file = files.find((f) => f.new_path === p.new_path) ?? files.find((f) => f.old_path === p.old_path);
  if (!file?.rows) return [];
  const at = (end) => file.rows.findIndex((r) => r.kind !== "hunk"
    && (end.new_line != null ? r.new === end.new_line : r.kind === "del" && r.old === end.old_line));
  const last = at({ new_line: p.new_line ?? null, old_line: p.old_line ?? null });
  if (last < 0) return [];
  const first = p.line_range ? at(p.line_range.start) : last;
  if (first < 0) return [file.rows[last]];
  return file.rows.slice(Math.min(first, last), Math.max(first, last) + 1).filter((r) => r.kind !== "hunk");
}

export function reviewMessage({ branch, base }, notes, files, threads = []) {
  const head = `Review of my local changes on ${branch}${base ? ` (against ${base})` : ""}: ${notes.length} comment${notes.length > 1 ? "s" : ""}. Address each one, then tell me what you changed.`;
  const parts = notes.map((n, i) => {
    if (n.discussionId) {
      const said = (threads.find((x) => x.id === n.discussionId)?.notes ?? []).filter((x) => !x.system);
      const p = said[0]?.position;
      const where = p && (p.new_line != null || p.old_line != null) ? ` (${noteLines(p)})` : "";
      const rows = where ? rowsFor(p, files) : [];
      const code = rows.length ? `\n\`\`\`\n${rows.map((r) => `${sign(r)} ${r.text}`).join("\n")}\n\`\`\`` : "";
      const quoted = said.map((x) => `> @${x.author?.username ?? "?"}: ${x.body}`).join("\n");
      return `${i + 1}. Reply on the thread by ${n.who ?? `@${said[0]?.author?.username ?? "?"}`}${where}${code}${quoted ? `\n${quoted}` : ""}\nMy reply: ${n.note}`;
    }
    if (!n.position) return `${i + 1}. General\n${n.note}`;
    const rows = rowsFor(n.position, files);
    const removed = rows.length === 1 && rows[0].kind === "del" && !n.position.line_range;
    const code = rows.length ? `\n\`\`\`\n${rows.map((r) => `${sign(r)} ${r.text}`).join("\n")}\n\`\`\`` : "";
    return `${i + 1}. ${noteLines(n.position)}${removed ? " (removed line)" : ""}${code}\n${n.note}`;
  });
  return [head, ...parts].join("\n\n");
}

const AGENTS = { "claude-code": "Claude", claude: "Claude", pi: "Pi", codex: "Codex", gemini: "Gemini", opencode: "OpenCode" };

export function agentLabel(app) {
  const name = String(app ?? "").toLowerCase();
  return AGENTS[name] ?? (name ? name[0].toUpperCase() + name.slice(1) : "the agent");
}

export function threadsMessage({ iid, branch }, threads, files) {
  const head = `Reviewers left ${threads.length} thread${threads.length > 1 ? "s" : ""} on merge request !${iid}${branch ? ` (${branch})` : ""}. Address each one in this checkout, then tell me what you changed and what to answer.`;
  const parts = threads.map((x, i) => {
    const notes = (x.notes ?? []).filter((n) => !n.system);
    const p = notes[0]?.position;
    const said = notes.map((n) => `@${n.author?.username ?? "?"}: ${n.body}`).join("\n");
    if (!p || (p.new_line == null && p.old_line == null)) return `${i + 1}. General\n${said}`;
    const rows = rowsFor(p, files);
    const code = rows.length ? `\n\`\`\`\n${rows.map((r) => `${sign(r)} ${r.text}`).join("\n")}\n\`\`\`` : "";
    return `${i + 1}. ${noteLines(p)}${code}\n${said}`;
  });
  return [head, ...parts].join("\n\n");
}

const STAMP = 'cd "$1" || exit 1; git rev-parse HEAD; git rev-parse -q --verify "refs/remotes/origin/$(git branch --show-current)"; git diff HEAD --no-color --no-ext-diff | cksum; git ls-files -o --exclude-standard -z | xargs -0 stat -f "%m %z %N"';

export async function worktreeStamp(exec, top) {
  return (await exec("sh", ["-c", STAMP, "sh", top])).stdout;
}

export async function branchDiff(exec, top, { untracked: maxUntracked = 200, max = 400000 } = {}) {
  const git = (args) => exec("git", ["-C", top, ...args]);
  const names = async (args) => new Set((await git(["diff", "--name-only", "--no-ext-diff", "-M", ...args])).stdout.split("\n").filter(Boolean));
  const branch = (await git(["branch", "--show-current"])).stdout.trim() || "HEAD";
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const target = head.code === 0 ? head.stdout.trim() : "origin/main";
  if (branch !== "HEAD") await git(["fetch", "--quiet", "origin", branch]);
  const stamp = await worktreeStamp(exec, top);
  const mb = await git(["merge-base", "HEAD", target]);
  const fork = mb.code === 0 ? mb.stdout.trim() : null;
  const diff = await git(["diff", "--no-color", "--no-ext-diff", "-M", fork ?? "HEAD"]);
  if (diff.code !== 0) throw new Error(diff.stderr.trim() || "git diff failed");
  const untracked = (await git(["ls-files", "--others", "--exclude-standard"])).stdout.split("\n").filter(Boolean).slice(0, maxUntracked);
  const extra = await Promise.all(untracked.map((path) => git(["diff", "--no-color", "--no-index", "--", "/dev/null", path])));
  const count = async (range) => Number((await git(["rev-list", "--count", range])).stdout.trim()) || 0;
  const upstream = `origin/${branch}`;
  const pushed = branch !== "HEAD" && (await git(["rev-parse", "--verify", "--quiet", upstream])).code === 0;
  const shared = pushed ? (await git(["merge-base", "HEAD", upstream])).stdout.trim() || fork : fork;
  const [onRemote, committed, changed] = await Promise.all([
    pushed && fork && shared !== fork ? names([fork, shared]) : new Set(),
    shared ? names([shared, "HEAD"]) : new Set(),
    names(["HEAD"]),
  ]);
  for (const path of untracked) changed.add(path);
  const files = splitGitDiff([diff.stdout, ...extra.map((x) => x.stdout)].join("\n"))
    .map((f) => ({ ...f, too_large: f.diff.length > max, rows: f.diff.length > max ? [] : parseDiff(f.diff),
      state: { uncommitted: changed.has(f.new_path), committed: committed.has(f.new_path), pushed: onRemote.has(f.new_path) } }));
  const status = {
    pushed,
    ahead: pushed ? await count(`${upstream}..HEAD`) : fork ? await count(`${fork}..HEAD`) : 0,
    behind: pushed ? await count(`HEAD..${upstream}`) : 0,
    dirty: (await git(["status", "--porcelain"])).stdout.split("\n").filter(Boolean).length,
  };
  return { branch, base: target, files, status, stamp };
}

export function draftsQuestion({ iid }, drafts, files, threads = []) {
  const notes = drafts.map((x) => ({ id: x.id, note: x.note, position: x.position && (x.position.new_line != null || x.position.old_line != null) ? x.position : null,
    ...(x.discussion_id ? { discussionId: x.discussion_id } : {}) }));
  const body = reviewMessage({ branch: null, base: null }, notes, files, threads).split("\n\n").slice(1).join("\n\n");
  return `Here is my pending review of merge request !${iid}: ${drafts.length} comment${drafts.length > 1 ? "s" : ""}, not submitted yet. For each one, tell me if it is right, clear and worth posting, and what I missed in the merge request. Don't post anything.\n\n${body}`;
}
