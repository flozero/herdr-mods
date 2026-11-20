// Where an agent can work on an issue: the open spaces, the git repos inside them (on their own
// machine), and a new worktree on the issue's branch. Repos are matched to the issue by labels
// written as "owner/repo" (e.g. a GitHub integration's repo label) against each checkout's origin.

import { spaces, exec, run, openOverlay } from "herdr";

// Git checkouts in a folder and up to three levels below: "path\torigin\tbranch\tmain|wt" per line.
const SCAN = `cd "\${1:-$HOME}" 2>/dev/null || exit 0
for d in . * */* */*/*; do
  [ -e "$d/.git" ] || continue
  u=$(git -C "$d" remote get-url origin 2>/dev/null) || continue
  k=wt; [ -d "$d/.git" ] && k=main
  r=; [ "$k" = main ] && [ -d "$d/.claude/worktrees" ] && r="$(cd "$d/.claude/worktrees" && pwd -P)"
  printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$(cd "$d" && pwd -P)" "$u" "$(git -C "$d" branch --show-current 2>/dev/null)" "$k" "$r"
  [ "$k" = main ] || continue
  git -C "$d" worktree list --porcelain 2>/dev/null | awk -v u="$u" '
    /^worktree / { n++; p = substr($0, 10) }
    /^branch / && n > 1 { b = substr($0, 8); sub("^refs/heads/", "", b); printf "%s\\t%s\\t%s\\twt\\n", p, u, b }'
done`;

const placeKey = (machine, folder) => `${machine ?? ""}|${folder ?? ""}`;
const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const on = (machine) => (machine ? { on: machine } : {});
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "git@github.com:Owner/Repo.git" or "https://github.com/owner/repo" → "owner/repo".
export function repoOf(url) {
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return m ? m[1].toLowerCase() : null;
}

export function repoLabels(issue) {
  return (issue?.labels?.nodes ?? []).map((l) => l.name.trim().toLowerCase()).filter((n) => /^[\w.-]+\/[\w.-]+$/.test(n));
}

export function issueBranch(issue) {
  return (issue.branchName || "").split(/[^\x21-\x7e]/)[0].replace(/[-/.]+$/, "") || issue.identifier.toLowerCase();
}

export class Places {
  constructor(worktreeMod = null) { this.scans = {}; this.pending = new Map(); this.worktreeMod = worktreeMod; this.rename = (branch) => branch; this.preferred = null; this.orchestrate = false; }

  scanning() { return this.pending.size > 0; }

  scanAll() {
    for (const s of spaces()) {
      const k = placeKey(s.machine, s.folder);
      if (this.scans[k] || this.pending.has(k)) continue;
      const p = exec("sh", ["-c", SCAN, "sh", s.folder || ""], on(s.machine))
        .then((r) => {
          const seen = new Set();
          return r.stdout.split("\n").filter(Boolean).map((l) => {
            const [path, origin, branch, kind, root] = l.split("\t");
            return { path, repo: repoOf(origin), branch: branch || null, main: kind === "main", root: root || null };
          }).filter((r) => !seen.has(r.path) && seen.add(r.path));
        })
        .catch(() => [])
        .then((list) => { this.scans[k] = list; this.pending.delete(k); });
      this.pending.set(k, p);
    }
    return Promise.all(this.pending.values());
  }

  choices(issue) {
    const labels = repoLabels(issue);
    const branch = this.rename(issueBranch(issue));
    const ids = [issue.identifier, issue.parent?.identifier].filter(Boolean)
      .map((x) => new RegExp(`(^|[^a-z0-9])${escape(x.toLowerCase())}($|[^0-9])`));
    const mine = (r) => r.branch === branch || ids.some((x) => x.test(`${r.path} ${r.branch ?? ""}`.toLowerCase()));
    const shownIn = (machine, folder) => spaces().find((s) => (s.machine ?? null) === machine && s.folder === folder);
    const out = [], seen = new Set();
    const add = (k, c) => { if (!seen.has(k)) { seen.add(k); out.push(c); } };
    for (const s of spaces()) {
      const machine = s.machine ?? null;
      for (const r of this.scans[placeKey(s.machine, s.folder)] ?? []) {
        if (mine(r)) {
          const shown = shownIn(machine, r.path);
          add(`here|${machine}|${r.path}`, shown
            ? { kind: "tab", rank: 3, space: shown, folder: r.path, repo: r.repo, branch: r.branch }
            : { kind: "open", rank: 3, machine, folder: r.path, repo: r.repo, branch: r.branch });
        } else if (r.main && r.repo) {
          const rank = !machine && r.path === this.preferred ? 2.5 : labels.includes(r.repo) ? 2 : 1;
          add(`worktree|${machine}|${r.path}`, { kind: "worktree", rank, machine, folder: r.path, repo: r.repo, branch,
            dest: r.root ? `${r.root}/${slug(branch)}` : null });
        }
      }
    }
    for (const s of spaces()) {
      const main = this.orchestrate && !s.machine && s.folder === this.preferred;
      add(`space|${s.id}`, { kind: "tab", rank: main ? 2.7 : 0, space: s, folder: s.folder, repo: null, branch: s.branch ?? null });
    }
    return out.sort((a, b) => b.rank - a.rank);
  }

  async start(c, { name, argv, task }) {
    if (c.kind === "tab") {
      run("tab.new", { space: c.space.id, folder: c.folder || undefined, name, argv, task });
      run("space.select", { id: c.space.id });
      return;
    }
    if (c.kind === "open") {
      run("space.new", { folder: c.folder, ...(c.machine ? { machine: c.machine } : {}), tab: name, argv, task });
      return;
    }
    if (this.worktreeMod) {
      openOverlay({ mod: this.worktreeMod, kind: "dialog", width: 460, height: 280,
        props: { folder: c.folder, machine: c.machine, branch: c.branch, tab: name, argv, task, repoSpace: true } });
      return;
    }
    const o = on(c.machine);
    const home = (await exec("sh", ["-c", 'printf %s "$HOME"'], o)).stdout.trim();
    const path = c.dest ?? `${home}/.herdr/worktrees/${c.folder.split("/").pop()}/${slug(c.branch)}`;
    if ((await exec("test", ["-e", path], o)).code !== 0) {
      const has = (await exec("git", ["-C", c.folder, "show-ref", "--verify", "--quiet", `refs/heads/${c.branch}`], o)).code === 0;
      const r = await exec("git", ["-C", c.folder, "worktree", "add", ...(has ? [path, c.branch] : ["-b", c.branch, path, "HEAD"])], o);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
    }
    run("space.new", { folder: path, ...(c.machine ? { machine: c.machine } : {}), tab: name, argv, task });
  }
}
