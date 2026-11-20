import { View, div } from "gpui-kit";
import { spaces, panes, exec, run, shared, checking, watchFolder, notify } from "herdr";

const FALLBACK = 60_000;
const CLAIM = 600_000;

function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

const inside = (path, dir) => path === dir || path.startsWith(dir + "/");

function hasSpace(c, list, on, sp, ps) {
  for (const s of sp) {
    if ((s.machine ?? null) !== on) continue;
    const at = place(s, ps)?.replace(/\\/g, "/");
    if (!at || !inside(at, c.path)) continue;
    const nested = list.some((o) => o.path !== c.path && o.path.length > c.path.length && inside(at, o.path));
    if (!nested) return true;
  }
  return false;
}

function parse(text) {
  const list = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    list.push({ path, branch });
  }
  return list;
}

export default class WorktreeSync extends View {
  init(_props, cx) {
    if (checking()) return;
    try { this.seen = JSON.parse(localStorage.getItem("seen") ?? "{}"); } catch { this.seen = {}; }
    this.repoAt = {};
    this.watching = new Set();
    this.places = "";
    this.handled = shared("worktree-sync.request")?.at ?? null;
    cx.timer.every(FALLBACK, (cx) => this.look(cx));
    cx.timer.every(2000, (cx) => {
      const request = shared("worktree-sync.request");
      if (request?.at && request.at !== this.handled) {
        this.handled = request.at;
        cx.spawn(async () => {
          try { await this.syncExisting(request.space); } catch (error) { notify({ title: "Couldn't sync worktrees", body: String(error?.message ?? error), level: "error" }); }
        });
      }
      const ps = panes();
      const now = JSON.stringify(spaces().map((s) => [s.machine ?? null, place(s, ps)]));
      if (now === this.places) return;
      this.places = now;
      this.look(cx);
    });
  }

  look(cx) {
    if (this.looking) {
      this.again = true;
      return;
    }
    this.looking = true;
    cx.spawn(async (cx) => {
      try { await this.sync(cx); } catch (error) { console.log(`worktree-sync: ${error}`); }
      this.looking = false;
      if (this.again) {
        this.again = false;
        this.look(cx);
      }
    });
  }

  async sync(cx) {
    const repos = new Map();
    const ps = panes();
    for (const s of spaces()) {
      const at = place(s, ps);
      if (!at) continue;
      const on = s.machine ?? null;
      const where = JSON.stringify([on, at]);
      if (!(where in this.repoAt)) {
        try {
          const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: at, on });
          this.repoAt[where] = r.code === 0 ? r.stdout.trim() : null;
        } catch { continue; }
      }
      const dir = this.repoAt[where];
      if (dir) repos.set(JSON.stringify([on, dir]), { on, dir, at });
    }
    this.inView = new Set([...repos.values()].filter((r) => r.on === null).map((r) => r.dir));
    for (const [key, { on, dir, at }] of repos) {
      let r;
      try { r = await exec("git", ["worktree", "list", "--porcelain"], { cwd: at, on }); } catch { continue; }
      if (r.code !== 0) continue;
      const list = parse(r.stdout);
      const known = this.seen[key];
      if (known) {
        const now = Date.now();
        const claims = shared("worktree-sync.claims") ?? {};
        const sp = spaces(), ps2 = panes();
        for (const c of list) {
          if (known.includes(c.path)) continue;
          const claimed = c.branch !== null && now - (claims[c.branch] ?? 0) < CLAIM;
          if (!claimed && !hasSpace(c, list, on, sp, ps2)) run("space.new", { folder: c.path, machine: on ?? "", focus: false });
        }
      }
      this.seen[key] = list.map((c) => c.path);
      if (on === null) this.watch(dir, cx);
    }
    try { localStorage.setItem("seen", JSON.stringify(this.seen)); } catch {}
  }

  async syncExisting(spaceId) {
    const space = spaces().find((s) => s.id === spaceId);
    const at = space && place(space, panes());
    if (!at) return notify({ title: "Couldn't sync worktrees", body: "This space has no folder.", level: "error" });
    const on = space.machine ?? null;
    const r = await exec("git", ["worktree", "list", "--porcelain"], { cwd: at, on });
    if (r.code !== 0) return notify({ title: "Couldn't sync worktrees", body: (r.stderr || r.stdout).trim() || "git worktree list failed.", level: "error" });
    const list = parse(r.stdout);
    const sp = spaces(), ps = panes();
    const missing = list.filter((c) => !hasSpace(c, list, on, sp, ps));
    for (const c of missing) run("space.new", { folder: c.path, machine: on ?? "", focus: false });
    notify({
      title: "Worktrees synced",
      body: missing.length ? `${missing.length} space${missing.length > 1 ? "s" : ""} added: ${missing.map((c) => c.branch ?? c.path.split("/").pop()).join(", ")}.` : "Every worktree already has its space.",
      level: "success",
    });
  }

  watch(dir, cx) {
    if (this.watching.has(dir)) return;
    this.watching.add(dir);
    cx.spawn(async (cx) => {
      try {
        while (this.inView.has(dir)) {
          await watchFolder(dir);
          this.look(cx);
        }
      } catch {}
      this.watching.delete(dir);
    });
  }

  render() {
    return div();
  }
}
