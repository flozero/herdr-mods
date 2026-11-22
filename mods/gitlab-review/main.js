import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView, Popup } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, run, focused, panes, spaces, terminals, hc, exec, nextCommand, appHome, home } from "herdr";
import * as fs from "fs/promises";
import * as gl from "./gitlab.js";
import { parseDiff, onRow, excerpt, position, splitRows, splitGitDiff, gapAt, expandGap } from "./diff.js";
import { splitDetails, gitlabLinks } from "./md.js";
import { reviewMessage, threadsMessage, branchDiff, worktreeStamp, draftsQuestion } from "./local.js";
import { fetchRules, matchRules } from "./rules.js";
import { editPoint, mentionAt, rankPeople, insertMention } from "./mention.js";
import { branchCheckout, installedEditors, openIn, worktreeSetup, HERDR_EDITOR } from "./editor.js";
import { agentArgv, agentName, askArgv } from "./agent.js";


const MONO = "JetBrains Mono";
const MAX_ROWS = 4000;
const FILES_W = 280;
const SIDEBAR_W = 270;
const STACK_DEPTH = 20;
const STACK_EVERY = 60000;
const DRAFT_PREFIX = /^\s*(\[draft\]|\(draft\)|draft:|draft\s-\s|draft\s)\s*/i;
let ROW_SEQ = 0;
const rowId = (row) => { if (row.id === undefined) row.id = ++ROW_SEQ; return row.id; };
const MR_STATE = { opened: ["Open", "#108548"], draft: ["Draft", "#737278"], merged: ["Merged", "#1f75cb"], closed: ["Closed", "#dd2b0e"], locked: ["Locked", "#737278"] };
const ADD_BG = "#2ea04326";
const DEL_BG = "#f8514926";
const HIT_BG = "#d2992240";
const JUMP_BG = "#d2992299";
const CURSOR_BG = "#388bfd40";
const MAX_REFS = 500;
const JUMP_ABOVE = 6;
const CODE_ROW = 18;
const CODE_MARGIN = 48;
const CODE_JUMP = 8;
const THREADS_EVERY = 60000;
const CALL_LIMIT = 90000;
const DENY = [
  "Edit", "Write", "NotebookEdit",
  "Bash(glab mr note:*)", "Bash(glab mr approve:*)", "Bash(glab mr revoke:*)", "Bash(glab mr merge:*)",
  "Bash(glab mr update:*)", "Bash(glab mr close:*)", "Bash(glab mr reopen:*)", "Bash(glab mr rebase:*)",
  "Bash(glab mr checkout:*)", "Bash(glab api:*)",
  "Bash(git checkout:*)", "Bash(git switch:*)", "Bash(git commit:*)", "Bash(git push:*)",
  "Bash(git reset:*)", "Bash(git stash:*)", "Bash(git rebase:*)", "Bash(git merge:*)",
];
const TABS = ["description", "changes", "comments", "review"];
const LIST_TABS = ["mine", "review", "ignored", "merged"];
const LIST_LABEL = { mine: "Mine", review: "To review", ignored: "Ignored", merged: "Merged" };
const cacheDir = () => `${appHome()}/mods/gitlab-review/.cache`;
const ignoredFile = () => `${cacheDir()}/ignored.json`;
const seenFile = () => `${cacheDir()}/seen.json`;
const editorFile = () => `${cacheDir()}/editor.json`;
const prefsFile = () => `${cacheDir()}/prefs.json`;
const notesFile = () => `${cacheDir()}/local.json`;
const LOCAL_UNTRACKED = 200;
const LOCAL_MAX = 400000;
const LOCAL_EVERY = 3000;
const FILE_STATE = [["uncommitted", "not committed", "accent"], ["committed", "committed", "muted"], ["pushed", "pushed", "done"]];
const GENERAL = { kind: "general" };
const stop = (_e, cx) => cx.stop_propagation();
const safeBranch = (b) => (/^[\w./-]+$/.test(String(b ?? "")) ? b : "<the source branch from glab mr view>");

function ago(iso) {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso ?? "")) / 60000));
  if (!iso || isNaN(m)) return "";
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

const agoText = (iso) => (ago(iso) === "now" ? "just now" : `${ago(iso)} ago`);
const who = (u) => u?.username ? `@${u.username}` : "?";
const REVIEW_STATE = {
  APPROVED: ["approved", "done"], REQUESTED_CHANGES: ["changes requested", "blocked"], REVIEWED: ["commented", "muted"],
  REVIEW_STARTED: ["reviewing", "accent"], UNAPPROVED: ["approval removed", "muted"], UNREVIEWED: ["pending", "dim"],
};
const AVATAR_COLORS = ["#5e6ad2", "#26b5ce", "#4cb782", "#f2c94c", "#f2994a", "#eb5757", "#bb87fc", "#95a2b3"];
const initials = (name) => String(name ?? "?").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
const avatarColor = (name) => AVATAR_COLORS[[...String(name ?? "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];
const mySide = (side, username) => side?.reviewers.find((r) => r.username === username)?.state ?? null;
const fileMark = (f) => (f.new_file ? "A" : f.deleted_file ? "D" : f.renamed_file ? "R" : "M");
const humanNotes = (d) => d.notes.filter((n) => !n.system);
const firstLine = (text, max = 120) => {
  const line = String(text ?? "").split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

function repliesTo(threads, me, since) {
  const out = [];
  for (const x of threads) {
    const notes = humanNotes(x);
    const mine = notes.findIndex((n) => n.author?.username === me);
    if (mine < 0) continue;
    for (const n of notes.slice(mine + 1)) {
      if (n.author?.username !== me && (!since || String(n.created_at) > since)) out.push({ thread: x, note: n });
    }
  }
  return out;
}
const has = (text, q) => String(text ?? "").toLowerCase().includes(q);

const herdrEditorMod = async () => {
  for (const mod of ["code", "vscode"]) {
    if ((await exec("test", ["-f", `${appHome()}/mods/${mod}/main.js`]).catch(() => ({ code: 1 }))).code === 0) return mod;
  }
  return null;
};

export default class GitlabReview extends View {
  init(_props, cx) {
    this.focusUntil = Date.now() + 2000;
    this.handle = cx.focus_handle();
    this.cwd = props()?.cwd ?? this.focusedCwd();
    this.local = Boolean(props()?.local);
    this.remote = null;
    this.fixer = null;
    this.notes = [];
    this.claude = null;
    this.config = {};
    this.briefed = new Set();
    this.ignored = {};
    this.seen = {};
    this.lastVisit = {};
    this.mine = {};
    this.replied = {};
    this.merged = null;
    this.rules = null;
    this.rulesError = null;
    this.sources = new Map();
    this.expanding = false;
    this.anchor = null;
    this.top = null;
    this.project = null;
    this.user = null;
    this.mrs = [];
    this.authored = [];
    this.stackParents = {};
    this.health = {};
    this.sel = 0;
    this.details = {};
    this.iid = null;
    this.tab = "description";
    this.fullDiff = false;
    this.file = 0;
    this.area = "files";
    this.cursor = null;
    this.mark = null;
    this.ds = null;
    this.target = GENERAL;
    this.loading = new Set();
    this.status = null;
    this.flash = null;
    this.flashGen = 0;
    this.sending = false;
    this.reviewing = false;
    this.composing = false;
    this.draft = TextareaState.new({ rows: 3 });
    this.draft.set_auto_grow(3, 10);
    this.draft.on("change", (_e, cx) => cx.notify());
    this.draft.on("submit", (e, cx) => { if (e?.secondary) this.addToReview(cx); });
    this.draft.on("focus", (_e, cx) => { this.composing = true; cx.notify(); });
    this.draft.on("blur", (_e, cx) => { this.composing = false; cx.notify(); });
    this.descDraft = TextareaState.new({ rows: 12 });
    this.descDraft.set_auto_grow(10, 40);
    this.descDraft.on("change", (_e, cx) => { this.trackMention(cx); cx.notify(); });
    this.descDraft.on("submit", (e, cx) => { if (e?.secondary) this.saveDescription(cx); });
    this.descDraft.on("focus", (_e, cx) => { this.descFocused = true; cx.notify(); });
    this.descDraft.on("blur", (_e, cx) => { this.descFocused = false; cx.timer.after(200, (cx) => { if (!this.descFocused) { this.mention = null; cx.notify(); } }); cx.notify(); });
    this.openDetails = new Set();
    this.query = "";
    this.searchOpen = false;
    this.searchFocused = false;
    this.search = InputState.new({ placeholder: "Search what's loaded…" });
    this.search.on("change", (_e, cx) => {
      if (this.search.value() === this.query) return;
      this.query = this.search.value(); this.sel = 0; this.anchor = null;
      if (this.q() && this.merged === null && this.user) cx.spawn(async (cx) => this.loadMerged(cx));
      cx.notify();
    });
    this.search.on("submit", (_e, cx) => { if (this.iid && this.q()) this.refsOpen = true; this.handle.focus(); cx.notify(); });
    this.refsOpen = false;
    this.jump = null;
    this.search.on("focus", (_e, cx) => { this.searchFocused = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.searchFocused = false; cx.notify(); });
    this.peopleInput = InputState.new({ placeholder: "Search people" });
    this.peopleInput.on("change", (_e, cx) => this.searchPeople(cx));
    this.peopleInput.on("submit", (_e, cx) => { const list = this.peopleChoices(); const u = list[Math.min(this.peoplePick?.sel ?? 0, list.length - 1)]; if (u) this.togglePerson(this.peoplePick.kind, u, cx); });
    this.peopleInput.on("focus", (_e, cx) => { this.peopleFocused = true; cx.notify(); });
    this.peopleInput.on("blur", (_e, cx) => { this.peopleFocused = false; cx.notify(); });
    this.peoplePick = null;
    this.askedAt = 0;
    this.editors = null;
    this.editor = null;
    this.editorMenu = false;
    this.split = false;
    this.listTab = "review";
    this.openingEditor = false;
    cx.spawn(async (cx) => this.loadEditors(cx));
    cx.spawn(async (cx) => this.start(cx));
    cx.timer.after(300, () => this.handle.focus());
    cx.timer.every(THREADS_EVERY, (cx) => { if (this.iid && this.iid !== "local" && !this.sending) cx.spawn(async (cx) => this.reloadThreads(cx, this.iid)); });
    cx.spawn(async (cx) => this.commands(cx));
    cx.timer.every(250, () => this.keepFocus());
    cx.timer.every(LOCAL_EVERY, (cx) => this.watchBranch(cx));
  }

  keepFocus() {
    if (props()?.overlay || this.composing || this.searchFocused || this.descFocused || this.peopleFocused) return;
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const was = this.lastPane;
    this.lastPane = pane?.pane ?? null;
    if (this.handle.is_focused()) {
      if (pane?.mod === "gitlab-review") this.myPane = pane.pane;
      return;
    }
    const all = panes().filter((p) => p.mod === "gitlab-review");
    const own = this.myPane ?? (all.length === 1 ? all[0].pane : null);
    if (own && pane?.pane === own && was !== own) this.focusUntil = Date.now() + 1500;
    const target = own ?? (pane?.mod === "gitlab-review" ? pane.pane : null);
    if (target && pane?.pane === target && Date.now() < (this.focusUntil ?? 0)) this.handle.focus();
  }

  q() { return this.query.trim().toLowerCase(); }

  openSearch(cx) {
    this.searchOpen = true;
    cx.timer.after(0, () => this.search.focus());
    cx.notify();
  }

  closeSearch(cx) {
    this.refsOpen = false;
    if (this.query) { this.search.set_value(""); this.query = ""; }
    else this.searchOpen = false;
    this.handle.focus();
    cx.notify();
  }

  shownMrs() {
    const q = this.q();
    return q ? this.mrs.filter((m) => [`!${m.iid}`, m.title, m.author?.username, m.source_branch].some((x) => has(x, q))) : this.mrs;
  }

  matches(m, q) {
    return [`!${m.iid}`, m.title, m.author?.username, m.source_branch].some((x) => has(x, q));
  }

  listed() {
    const shown = this.shownMrs();
    const q = this.q();
    if (this.listTab === "mine") return this.authored.filter((m) => !q || this.matches(m, q)).map((m) => ({ m, ignored: false, own: true }));
    if (this.listTab === "ignored") return shown.filter((m) => this.ignored[m.iid]).map((m) => ({ m, ignored: true }));
    if (this.listTab === "merged") return (this.merged ?? []).filter((m) => !q || this.matches(m, q)).map((m) => ({ m, ignored: false, merged: true }));
    const live = shown.filter((m) => !this.ignored[m.iid]);
    return [
      ...live.filter((m) => this.replied[m.iid]).map((m) => ({ m, ignored: false, replied: true })),
      ...live.filter((m) => !this.replied[m.iid]).map((m) => ({ m, ignored: false })),
    ];
  }

  async loadMerged(cx) {
    if (this.loading.has("merged")) return;
    const merged = await this.call(cx, "merged", () => gl.merged(this.top, this.user.username));
    if (!merged) return;
    this.merged = merged;
    const mine = await this.call(cx, "summary-merged", () => gl.reviewSummary(this.top, this.project.path_with_namespace, merged.map((m) => m.iid), this.user.username));
    if (mine) this.mine = { ...mine, ...this.mine };
    cx.notify();
  }

  toggleMerged(cx) {
    this.setListTab(this.listTab === "merged" ? "review" : "merged", cx);
  }

  async loadEditors(cx) {
    const [found, saved, prefs, herdrEditor] = await Promise.all([installedEditors(exec).catch(() => []), this.readStore(editorFile()), this.readStore(prefsFile()),
      herdrEditorMod()]);
    this.herdrEditor = herdrEditor;
    const editors = herdrEditor ? [HERDR_EDITOR, ...found] : found;
    this.editors = editors;
    this.editor = saved.app ?? null;
    this.split = Boolean(prefs.split);
    if (LIST_TABS.includes(prefs.listTab)) this.listTab = prefs.listTab;
    cx.notify();
  }

  toggleSplit(cx) {
    this.split = !this.split;
    cx.notify();
    this.savePrefs(cx);
  }

  savePrefs(cx) {
    const prefs = { split: this.split, listTab: this.listTab };
    cx.spawn(async (cx) => {
      try {
        await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", cacheDir()]);
        await fs.writeFile(prefsFile(), JSON.stringify(prefs));
      } catch (e) { this.say(`Couldn't save prefs.json: ${e?.message ?? e}`, cx, "error"); }
    });
  }

  setListTab(tab, cx) {
    if (!LIST_TABS.includes(tab)) return;
    this.listTab = tab;
    this.sel = 0;
    this.anchor = null;
    if (tab === "merged" && this.merged === null && this.user) cx.spawn(async (cx) => this.loadMerged(cx));
    this.savePrefs(cx);
    cx.notify();
  }

  listCounts() {
    const q = this.q();
    const shown = this.shownMrs();
    return {
      mine: this.authored.filter((m) => !q || this.matches(m, q)).length,
      review: shown.filter((m) => !this.ignored[m.iid]).length,
      ignored: shown.filter((m) => this.ignored[m.iid]).length,
      merged: this.merged ? this.merged.filter((m) => !q || this.matches(m, q)).length : null,
    };
  }

  listTabs(t) {
    const counts = this.listCounts();
    return h_flex().h(36).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .children(LIST_TABS.map((tab, n) => {
        const on = this.listTab === tab;
        const count = tab === "merged" && counts.merged === null ? (this.loading.has("merged") ? "…" : "last 30") : String(counts[tab]);
        return h_flex().id(`lt-${tab}`).h(24).px(10).gap(6).items_center().rounded(12).border_1().text_size(12).cursor_pointer()
          .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted)
          .on_mouse_down("left", stop).on_click((_e, cx) => this.setListTab(tab, cx))
          .child(`${n + 1}  ${LIST_LABEL[tab]}`).child(div().text_size(10.5).text_color(t.dim).child(count));
      }));
  }

  openStackBranch(m, cx) {
    if (!m.source_branch || this.openingStack) return;
    this.openingStack = true;
    this.say(`Opening the review of ${m.source_branch}…`, cx);
    cx.spawn(async (cx) => {
      try {
        const { path, created, main } = await branchCheckout(exec, this.top, m.source_branch, home());
        if (created && path !== main) {
          this.say(`Setting up the worktree for ${m.source_branch}…`, cx);
          const setup = await worktreeSetup({ exec, readFile: fs.readFile, appHome: appHome(), userHome: home(), main, path, branch: m.source_branch });
          if (setup.code !== 0) this.say(`Worktree setup failed: ${(setup.stderr || setup.stdout || "").trim().split("\n").pop()}`, cx, "error");
        }
        const name = `Review · ${path.split("/").pop()}`;
        for (const space of spaces()) {
          const tab = space.tabs.find((x) => x.name === name && panes().some((pane) => pane.tab === x.id && pane.mod === "gitlab-review"));
          if (tab) {
            run("space.select", { id: space.id });
            run("tab.select", { id: tab.id });
            return;
          }
        }
        const space = spaces().find((x) => x.folder === path);
        if (!space) run("space.new", { folder: path, name: path.split("/").pop() });
        run("tab.new", { name, mod: "gitlab-review", props: { cwd: path, local: true }, ...(space ? { space: space.id } : {}) });
        this.say(`${created ? "Worktree created: " : ""}${m.source_branch} opened for review`, cx, "success");
      } catch (e) {
        this.say(`Couldn't open ${m.source_branch}: ${e?.message ?? e}`, cx, "error");
      } finally {
        this.openingStack = false;
        cx.notify();
      }
    });
  }

  async openPath(app, path) {
    if (app !== HERDR_EDITOR) return openIn(exec, app, path);
    const mod = this.herdrEditor ?? "vscode";
    const name = `${mod === "code" ? "Code" : "VS Code"} · ${path.split("/").pop()}`;
    for (const space of spaces()) {
      const tab = space.tabs.find((candidate) => candidate.name === name && panes().some((pane) => pane.tab === candidate.id && pane.mod === mod));
      if (tab) {
        run("space.select", { id: space.id });
        run("tab.select", { id: tab.id });
        return { code: 0 };
      }
    }
    const home = spaces().find((space) => space.folder === path);
    if (!home) run("space.new", { folder: path, name: path.split("/").pop() });
    const editorProps = mod === "code" ? { root: path, mode: "changes" } : { folder: path };
    run("tab.new", { name, mod, props: editorProps, ...(home ? { space: home.id } : {}) });
    return { code: 0 };
  }

  toggleEditorMenu(cx) {
    this.editorMenu = !this.editorMenu;
    cx.notify();
  }

  openEditor(app, cx) {
    const mr = this.details[this.iid]?.mr;
    this.editorMenu = false;
    cx.notify();
    if (!mr || this.openingEditor) return;
    if (this.local) {
      this.editor = app;
      cx.spawn(async (cx) => {
        const r = await this.openPath(app, this.top);
        this.say(r.code === 0 ? `${this.top.split("/").pop()} opened in ${app}` : `Couldn't open it in ${app}`, cx, r.code === 0 ? "success" : "error");
      });
      return;
    }
    if (mr.source_project_id !== mr.target_project_id) { this.say(`!${mr.iid} comes from a fork: open it in the browser`, cx, "error"); return; }
    if (app !== this.editor) {
      this.editor = app;
      cx.spawn(async (cx) => {
        try {
          await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", cacheDir()]);
          await fs.writeFile(editorFile(), JSON.stringify({ app }));
        } catch (e) { this.say(`Couldn't save editor.json: ${e?.message ?? e}`, cx, "error"); }
      });
    }
    this.openingEditor = true;
    this.say(`Opening ${mr.source_branch} in ${app}…`, cx);
    cx.spawn(async (cx) => {
      try {
        const { path, created, main } = await branchCheckout(exec, this.top, mr.source_branch, home());
        if (path !== main) {
          this.say(`Setting up the worktree for ${mr.source_branch}…`, cx);
          const setup = await worktreeSetup({ exec, readFile: fs.readFile, appHome: appHome(), userHome: home(), main, path, branch: mr.source_branch });
          if (setup.code !== 0) this.say(`Worktree setup failed: ${(setup.stderr || setup.stdout || "").trim().split("\n").pop()}`, cx, "error");
        }
        const r = await this.openPath(app, path);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || "").trim() || `${app} didn't open`);
        this.say(`${created ? "Worktree created: " : ""}${mr.source_branch} opened in ${app}`, cx, "success");
      } catch (e) {
        this.say(`Couldn't open it in ${app}: ${e?.message ?? e}`, cx, "error");
      } finally {
        this.openingEditor = false;
        cx.notify();
      }
    });
  }

  async readStore(file) {
    try { return JSON.parse(await fs.readFile(file, "utf8")) ?? {}; } catch { return {}; }
  }

  async loadStores() {
    const key = this.project.path_with_namespace;
    this.ignored = (await this.readStore(ignoredFile()))[key] ?? {};
    this.seen = (await this.readStore(seenFile()))[key] ?? {};
  }

  async writeStore(file, value) {
    const all = await this.readStore(file);
    all[this.project.path_with_namespace] = value;
    const tmp = `${file}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", cacheDir()]);
    await fs.writeFile(tmp, JSON.stringify(all));
    const r = await exec("mv", ["-f", tmp, file]);
    if (r.code !== 0) throw new Error(r.stderr.trim());
  }

  persist(file, value, cx) {
    const write = (this.saving ?? Promise.resolve()).then(() => this.writeStore(file, value));
    this.saving = write.catch(() => {});
    cx.spawn(async (cx) => {
      try { await write; } catch (e) { this.say(`Couldn't save ${file.split("/").pop()}: ${e?.message ?? e}`, cx, "error"); }
    });
  }

  markSeen(mr, cx, approved = this.seen[mr.iid]?.approved ?? false) {
    if (this.replied[mr.iid]) { const { [mr.iid]: _gone, ...rest } = this.replied; this.replied = rest; }
    this.seen = { ...this.seen, [mr.iid]: { at: new Date().toISOString(), updated_at: mr.updated_at, sha: mr.sha, notes: mr.user_notes_count ?? 0, approved } };
    this.mrs = this.mrs.map((m) => (m.iid === mr.iid ? { ...m, updated_at: mr.updated_at, sha: mr.sha, user_notes_count: mr.user_notes_count } : m));
    this.persist(seenFile(), this.seen, cx);
  }

  news(m) {
    const s = this.seen[m.iid];
    if (!s) return { kind: "new" };
    const commits = Boolean(m.sha && s.sha && m.sha !== s.sha);
    const notes = Math.max(0, (m.user_notes_count ?? 0) - (s.notes ?? 0));
    const other = !commits && !notes && String(m.updated_at) > String(s.updated_at);
    return commits || notes || other ? { kind: "updated", commits, notes, other, at: s.at } : { kind: "seen", at: s.at };
  }

  isFresh(n) {
    const since = this.lastVisit[this.iid]?.at;
    return Boolean(since) && String(n.created_at) > since && n.author?.username !== this.user?.username;
  }

  picked() {
    const rows = this.listed();
    if (this.anchor === null || this.anchor === undefined) return rows[this.sel] ? [rows[this.sel]] : [];
    const [a, b] = [Math.min(this.anchor, this.sel), Math.max(this.anchor, this.sel)];
    return rows.slice(a, b + 1);
  }

  inPick(n) {
    if (this.anchor === null || this.anchor === undefined) return n === this.sel;
    return n >= Math.min(this.anchor, this.sel) && n <= Math.max(this.anchor, this.sel);
  }

  extend(delta, cx) {
    const n = this.listed().length;
    if (!n) return;
    if (this.anchor === null || this.anchor === undefined) this.anchor = this.sel;
    this.sel = Math.max(0, Math.min(n - 1, this.sel + delta));
    cx.notify();
  }

  ignorePicked(cx) {
    const rows = this.picked().filter((x) => !x.merged && !x.own);
    if (rows.length < 2) { if (rows[0]) this.toggleIgnore(rows[0].m.iid, cx); this.anchor = null; return; }
    const on = rows.some((x) => !x.ignored);
    const at = new Date().toISOString();
    const next = { ...this.ignored };
    for (const { m } of rows) { if (on) next[m.iid] = { at }; else delete next[m.iid]; }
    this.ignored = next;
    this.anchor = null;
    const first = this.listed().findIndex((x) => x.m.iid === rows[0].m.iid);
    if (first >= 0) this.sel = first;
    this.say(on ? `${rows.length} merge requests ignored` : `${rows.length} merge requests back in To review`, cx);
    this.persist(ignoredFile(), this.ignored, cx);
  }

  toggleIgnore(iid, cx) {
    if (!iid || !this.project) return;
    const on = !this.ignored[iid];
    const { [iid]: _gone, ...rest } = this.ignored;
    this.ignored = on ? { ...rest, [iid]: { at: new Date().toISOString() } } : rest;
    if (!this.iid) {
      const n = this.listed().findIndex((x) => x.m.iid === iid);
      if (n >= 0) this.sel = n;
    }
    this.say(on ? `!${iid} ignored: it stays listed under Ignored` : `!${iid} is back in To review`, cx);
    this.persist(ignoredFile(), this.ignored, cx);
  }

  shownThreads(d) {
    const q = this.q();
    if (!q) return d.threads;
    return d.threads.filter((x) => humanNotes(x).some((n) => has(n.body, q) || has(n.author?.username, q))
      || has(humanNotes(x)[0]?.position?.new_path, q));
  }

  allFiles(d) {
    if (!d.sinceFiles?.length || this.fullDiff) return d.files;
    return [...d.sinceFiles, ...d.files.filter((f) => !d.since?.has(f.new_path))];
  }

  newOnly(d) { return Boolean(d.sinceFiles?.length) && !this.fullDiff; }

  toggleFullDiff(cx) {
    this.fullDiff = !this.fullDiff;
    this.file = 0; this.cursor = null; this.mark = null; this.area = "files"; this.jump = null;
    cx.notify();
  }

  shownFiles(d) {
    const q = this.q();
    return this.allFiles(d).map((f, index) => ({ f, index, hits: q ? f.rows.filter((r) => r.kind !== "hunk" && has(r.text, q)).length : 0 }))
      .filter((x) => !q || x.hits > 0 || has(x.f.new_path, q) || has(x.f.old_path, q));
  }

  async commands(cx) {
    let burst = 0, since = Date.now();
    for (;;) {
      let c;
      try { c = await nextCommand(); } catch { return; }
      if (c === undefined || c === null || c === "") return;
      if (Date.now() - since > 1000) { burst = 0; since = Date.now(); }
      if (++burst > 50) return;
      const [name, arg] = String(c).split(/[:\s]+/, 2);
      if (name === "open" && /^\d+$/.test(arg ?? "")) this.open(Number(arg), cx);
      else if (name === "tab" && TABS.includes(arg) && this.iid) this.setTab(arg, cx);
      else if (name === "file" && /^\d+$/.test(arg ?? "")) { this.file = Number(arg); cx.notify(); }
      else if (name === "back") this.back(cx);
      else if (name === "refresh") this.reload(cx);
      else if (name === "close") this.dismiss();
      else if (name === "focus") this.handle.focus();
      else if (name === "draft") this.draft.set_value(String(c).replace(/^draft[:\s]?/, ""));
      else if (name === "post") this.post(cx);
      else if (name === "add") this.addToReview(cx);
      else if (name === "refs") this.refsOpen = !this.refsOpen;
      else if (name === "merged") this.toggleMerged(cx);
      else if (name === "ref" && /^\d+$/.test(arg ?? "") && this.details[this.iid]) { const r = this.refs(this.details[this.iid])[Number(arg)]; if (r) this.openRef(r, cx); }
      else if (name === "ignore" && /^\d+$/.test(arg ?? "")) this.toggleIgnore(Number(arg), cx);
      else if (name === "ask") this.ask(cx);
      else if (name === "search") { this.search.set_value(String(c).replace(/^search[:\s]?/, "")); this.query = this.search.value(); this.searchOpen = true; }
      cx.notify();
    }
  }

  focusedCwd() {
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    return pane?.cwd ?? f?.cwd ?? spaces().find((s) => s.active)?.folder ?? null;
  }

  async start(cx) {
    if (!this.cwd) { this.fail("No focused folder", cx); return; }
    const r = await exec("git", ["-C", this.cwd, "rev-parse", "--show-toplevel"]).catch(() => null);
    if (!r || r.code !== 0) { this.fail(`Not a git repository: ${this.cwd}`, cx); return; }
    this.top = r.stdout.trim();
    if (this.local) { await this.startLocal(cx); return; }
    const [project, user] = await Promise.all([
      this.call(cx, "project", () => gl.project(this.top)),
      this.call(cx, "user", () => gl.me(this.top)),
    ]);
    if (!project || !user) return;
    this.project = project;
    this.user = user;
    await this.loadStores();
    cx.spawn(async (cx) => this.loadRules(cx));
    await this.refresh(cx);
  }

  async startLocal(cx) {
    this.iid = "local";
    this.tab = "changes";
    this.notes = (await this.readStore(notesFile()))[this.top] ?? [];
    await this.loadBranch(cx);
    cx.spawn(async (cx) => this.loadRules(cx));
    cx.spawn(async (cx) => { if (await this.findRemote(cx)) await this.loadBranch(cx); });
  }

  async findRemote(cx) {
    if (!this.project || !this.user) {
      const [project, user] = await Promise.all([gl.project(this.top).catch(() => null), gl.me(this.top).catch(() => null)]);
      if (!project || !user) return false;
      this.project = project;
      this.user = user;
      await this.loadStores();
    }
    const r = await exec("git", ["-C", this.top, "rev-parse", "--abbrev-ref", "HEAD"]).catch(() => null);
    const branch = r?.code === 0 ? r.stdout.trim() : null;
    if (!branch || branch === "HEAD") return false;
    const list = await gl.forBranch(this.top, branch).catch(() => null);
    if (!Array.isArray(list)) return false;
    const mr = list[0] ?? null;
    if (String(mr?.iid ?? "") === String(this.remote?.iid ?? "")) return false;
    const prev = this.details[this.iid];
    this.remote = mr;
    this.iid = mr ? mr.iid : "local";
    if (prev) this.details[this.iid] = { ...prev, mr: mr ?? undefined };
    cx.notify();
    return true;
  }

  sendThreads(threads, cx) {
    const d = this.details[this.iid];
    if (!d || !this.local || this.sending || !threads.length) return;
    this.sending = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.handToClaude(threadsMessage({ iid: d.mr.iid, branch: d.mr.source_branch }, threads, d.files), cx);
        this.say(`Sent ${threads.length} thread${threads.length > 1 ? "s" : ""} to ${this.agentName()}, on the right`, cx, "success");
      } catch (e) {
        this.say(`Couldn't send: ${e?.message ?? e}`, cx, "error");
      } finally {
        this.sending = false;
        cx.notify();
      }
    });
  }

  openThreads(d) {
    return d.threads.filter((x) => {
      const first = humanNotes(x)[0];
      return first && !(first.resolvable && x.notes.every((n) => !n.resolvable || n.resolved));
    });
  }

  localDiff() {
    return branchDiff(exec, this.top, { untracked: LOCAL_UNTRACKED, max: LOCAL_MAX, base: this.remote?.target_branch ?? null });
  }

  shownHere() {
    const tab = focused()?.tab;
    if (!tab) return false;
    const mine = this.myPane ? panes().find((p) => p.pane === this.myPane) : null;
    if (mine) return mine.tab === tab;
    const name = `Review · ${this.top.split("/").pop()}`;
    return spaces().some((s) => s.tabs.some((x) => x.id === tab && x.name === name));
  }

  watchBranch(cx) {
    const d = this.details[this.iid];
    if (!this.local || !d?.stamp || this.watching || this.composing || this.sending || this.loading.has("local") || !this.shownHere()) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      try {
        const now = await worktreeStamp(exec, this.top).catch(() => null);
        if (now !== null && now !== this.details[this.iid]?.stamp && !this.composing) await this.loadBranch(cx);
      } finally {
        this.watching = false;
      }
    });
  }

  keepPlace(before, files) {
    const was = before?.[this.file];
    if (!was) return;
    const at = files.findIndex((f) => f.new_path === was.new_path);
    if (at >= 0 && files[at].diff === was.diff) { this.file = at; return; }
    this.file = at >= 0 ? at : Math.min(this.file, Math.max(0, files.length - 1));
    this.cursor = null; this.mark = null; this.jump = null;
    if (this.area === "code" && at < 0) this.area = "files";
  }

  async loadBranch(cx) {
    const iid = this.iid, remote = this.remote;
    const [local, mr, threads, drafts, approvals, side] = await Promise.all([
      this.call(cx, "local", () => this.localDiff()),
      remote ? this.call(cx, `mr:${remote.iid}`, () => gl.mergeRequest(this.top, remote.iid)) : null,
      remote ? this.call(cx, `threads:${remote.iid}`, () => gl.discussions(this.top, remote.iid)) : null,
      remote ? this.call(cx, `drafts:${remote.iid}`, () => gl.drafts(this.top, remote.iid)) : null,
      remote ? this.call(cx, `approvals:${remote.iid}`, () => gl.approvals(this.top, remote.iid)) : null,
      remote && this.project ? this.call(cx, `side:${remote.iid}`, () => gl.sidebar(this.top, this.project.path_with_namespace, remote.iid)) : null,
    ]);
    const prev = this.details[iid];
    if (!local && !prev) return;
    if (local && prev && iid === this.iid) this.keepPlace(prev.files, local.files);
    const pseudo = { iid: "local", title: local?.branch ?? "", description: null, web_url: null, diff_refs: {},
      source_branch: local?.branch, target_branch: local?.base, state: "local", author: null };
    this.details[iid] = {
      mr: mr ?? prev?.mr ?? pseudo,
      files: local?.files ?? prev?.files ?? [],
      status: local?.status ?? prev?.status ?? null,
      base: local?.base ?? prev?.base ?? null,
      stamp: local?.stamp ?? prev?.stamp ?? null,
      threads: threads ? threads.filter((x) => humanNotes(x).length) : prev?.threads ?? [],
      events: threads ? threads.flatMap((x) => x.notes.filter((n) => n.system)) : prev?.events ?? [],
      drafts: drafts ?? prev?.drafts ?? [],
      approvals: approvals ?? prev?.approvals ?? null,
      side: remote ? side ?? prev?.side ?? null : null,
      since: null, newCommits: [], state: side && this.user ? mySide(side, this.user.username) : null,
      stack: prev?.stack ?? null,
    };
    cx.notify();
    const shown = mr ?? prev?.mr ?? pseudo;
    if (shown.source_branch && Date.now() - (this.stackAt?.[shown.source_branch] ?? 0) > STACK_EVERY) {
      this.stackAt = { ...this.stackAt, [shown.source_branch]: Date.now() };
      const stack = await this.loadStack({ ...shown, target_branch: shown.target_branch?.replace(/^origin\//, "") });
      if (this.details[iid]) { this.details[iid].stack = stack; cx.notify(); }
    }
  }

  saveNotes(cx) {
    const notes = this.notes;
    cx.spawn(async (cx) => {
      try {
        const all = await this.readStore(notesFile());
        if (notes.length) all[this.top] = notes; else delete all[this.top];
        await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", cacheDir()]);
        await fs.writeFile(notesFile(), JSON.stringify(all));
      } catch (e) { this.say(`Couldn't save local.json: ${e?.message ?? e}`, cx, "error"); }
    });
  }

  addLocalNote(text, cx, quiet = false) {
    const payload = this.draftPayload(text);
    const t = this.target;
    this.notes = [...this.notes, { id: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`, note: payload.note, position: payload.position ?? null,
      ...(payload.in_reply_to_discussion_id ? { discussionId: payload.in_reply_to_discussion_id, who: t.who ?? null } : {}) }];
    this.draft.set_value("");
    this.target = GENERAL;
    this.saveNotes(cx);
    if (!quiet) this.say(`Added to your review: ${this.notes.length} pending · a sends it to ${this.agentName()}${this.remote ? ", or Post on GitLab" : ""}`, cx, "success");
    cx.notify();
  }

  discard(cx) {
    const d = this.details[this.iid];
    if (!d) return;
    if (!this.discardAsked || Date.now() - this.discardAsked > 3000) {
      this.discardAsked = Date.now();
      this.say("Press Discard all again to cancel every pending comment", cx);
      return;
    }
    this.discardAsked = 0;
    if (this.local) {
      const n = this.notes.length;
      this.notes = [];
      this.draft.set_value("");
      this.saveNotes(cx);
      this.say(`Discarded ${n} pending comment${n === 1 ? "" : "s"}`, cx);
      cx.notify();
      return;
    }
    const iid = this.iid, drafts = [...d.drafts];
    cx.spawn(async (cx) => {
      let done = 0;
      try {
        for (const x of drafts) { await gl.deleteDraft(this.top, iid, x.id); done++; }
        this.say(`Discarded ${done} pending comment${done === 1 ? "" : "s"}`, cx);
      } catch (e) {
        this.say(`Discarded ${done}, then GitLab refused: ${e?.message ?? e}`, cx, "error");
      }
      const fresh = await this.call(cx, `drafts:${iid}`, () => gl.drafts(this.top, iid));
      if (fresh) d.drafts = fresh;
      cx.notify();
    });
  }

  removeNote(id, cx) {
    this.notes = this.notes.filter((x) => x.id !== id);
    this.saveNotes(cx);
    this.say("Comment deleted", cx);
    cx.notify();
  }

  postNotes(cx) {
    const d = this.details[this.iid], mr = this.remote;
    if (!d || !mr || this.sending) return;
    const typed = this.draft.value().trim();
    if (typed) this.addLocalNote(typed, cx, true);
    if (!this.notes.length) { this.say("Your review is empty: c on a line, then ⌘↵", cx); return; }
    this.sending = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const refs = d.mr.diff_refs ?? {};
      let done = 0;
      try {
        for (const n of [...this.notes]) {
          if (n.discussionId) await gl.reply(this.top, mr.iid, n.discussionId, n.note);
          else if (n.position) await gl.discussion(this.top, mr.iid, n.note, { ...n.position, base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha });
          else await gl.comment(this.top, mr.iid, n.note);
          this.notes = this.notes.filter((x) => x !== n);
          done++;
        }
        this.say(`Posted ${done} comment${done > 1 ? "s" : ""} on !${mr.iid}`, cx, "success");
      } catch (e) {
        this.say(`${done ? `Posted ${done}, then ` : ""}GitLab refused one: ${e?.message ?? e}`, cx, "error");
      } finally {
        this.saveNotes(cx);
        this.sending = false;
        await this.reloadThreads(cx, mr.iid);
        cx.notify();
      }
    });
  }

  sendLocal(cx) {
    const d = this.details[this.iid];
    if (!d || this.sending) return;
    const typed = this.draft.value().trim();
    if (typed) this.addLocalNote(typed, cx, true);
    if (!this.notes.length) { this.say("Your review is empty: c on a line, then ⌘↵", cx); return; }
    this.sending = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const sent = this.notes;
        await this.handToClaude(reviewMessage({ branch: d.mr.source_branch, base: d.base }, sent, d.files, d.threads), cx);
        this.notes = this.notes.filter((n) => !sent.includes(n));
        this.saveNotes(cx);
        this.say(`Sent ${sent.length} comment${sent.length > 1 ? "s" : ""} to ${this.agentName()}, on the right`, cx, "success");
      } catch (e) {
        this.say(`Couldn't send: ${e?.message ?? e}`, cx, "error");
      } finally {
        this.sending = false;
        cx.notify();
      }
    });
  }

  branchBanner(t, d) {
    const st = d.status;
    if (!st) return div();
    const items = [
      !st.pushed && ["never pushed", t.accent],
      st.pushed && st.ahead > 0 && [`${st.ahead} commit${st.ahead > 1 ? "s" : ""} not pushed`, t.accent],
      st.dirty > 0 && [`${st.dirty} file${st.dirty > 1 ? "s" : ""} not committed`, t.accent],
      st.behind > 0 && [`origin has ${st.behind} commit${st.behind > 1 ? "s" : ""} you don't have: conflict to handle (pull or rebase)`, t.blocked],
      !this.remote && ["no merge request yet", t.muted],
    ].filter(Boolean);
    if (!items.length) return div();
    return h_flex().flex_none().px(16).py(6).gap(6).flex_wrap().items_center().border_b(1).border_color(t.border)
      .children(items.map(([text, color]) => this.chip(t, text, color)));
  }

  fail(text, cx) {
    this.status = { text, level: "error" };
    cx.notify();
  }

  async call(cx, label, fn) {
    this.loading.add(label);
    cx.notify();
    const started = (this.started ??= {})[label] = Date.now();
    cx.timer.after(CALL_LIMIT, (cx) => {
      if (!this.loading.has(label) || this.started[label] !== started) return;
      this.loading.delete(label);
      this.say(`GitLab didn't answer in ${CALL_LIMIT / 1000} s (${label.split(":")[0]}): ⌘R to try again`, cx, "error");
    });
    try {
      const r = await fn();
      if (this.status?.level === "error") this.status = null;
      return r;
    } catch (e) {
      this.status = { text: String(e?.message ?? e), level: "error" };
      return undefined;
    } finally {
      this.loading.delete(label);
      cx.notify();
    }
  }

  say(text, cx, level = "info") {
    this.flash = { text, level };
    const gen = ++this.flashGen;
    cx.timer.after(4000, (cx) => { if (gen === this.flashGen) { this.flash = null; cx.notify(); } });
    cx.notify();
  }

  reload(cx) {
    if (this.local) {
      this.say("Reloading the branch…", cx);
      cx.spawn(async (cx) => {
        const found = await this.findRemote(cx);
        await this.loadBranch(cx);
        if (this.status?.level !== "error") this.say(found && this.remote ? `Branch reloaded · merge request !${this.remote.iid} found` : "Branch reloaded", cx, "success");
      });
      return;
    }
    const iid = this.iid;
    this.say(iid ? `Reloading !${iid}…` : "Refreshing the list…", cx);
    cx.spawn(async (cx) => {
      if (iid) await this.loadMr(cx, iid); else await this.refresh(cx);
      if (this.status?.level !== "error") this.say(iid ? `!${iid} reloaded` : `List refreshed: ${this.listed().length} merge requests`, cx, "success");
    });
  }

  async refresh(cx) {
    if (!this.user) return;
    const [mrs, authored] = await Promise.all([
      this.call(cx, "mrs", () => gl.reviewing(this.top, this.user.username)),
      this.call(cx, "authored", () => gl.authored(this.top, this.user.username)),
    ]);
    if (authored) {
      this.authored = authored;
      const health = await this.call(cx, "health", () => gl.mrStatus(this.top, this.project.path_with_namespace, authored.map((m) => m.iid)));
      if (health) this.health = health;
    }
    if (mrs) {
      this.mrs = mrs;
      this.sel = Math.min(this.sel, Math.max(0, mrs.length - 1));
      this.anchor = null;
      const open = new Set([...mrs, ...this.authored].map((m) => String(m.iid)));
      const kept = Object.fromEntries(Object.entries(this.ignored).filter(([iid]) => open.has(iid)));
      if (Object.keys(kept).length !== Object.keys(this.ignored).length) { this.ignored = kept; this.persist(ignoredFile(), kept, cx); }
      const seen = Object.fromEntries(Object.entries(this.seen).filter(([iid]) => open.has(iid)));
      if (Object.keys(seen).length !== Object.keys(this.seen).length) { this.seen = seen; this.persist(seenFile(), seen, cx); }
    }
    await this.loadParents(cx, [...(mrs ?? []), ...this.authored]);
    if (mrs) {
      const mine = await this.call(cx, "summary", () => gl.reviewSummary(this.top, this.project.path_with_namespace, mrs.map((m) => m.iid), this.user.username));
      if (mine) this.mine = mine;
      await this.findReplies(cx, mrs);
    }
    if (this.merged !== null) await this.loadMerged(cx);
    if (this.iid) await this.loadMr(cx, this.iid);
  }

  baseBranch() {
    return this.project?.default_branch ?? "master";
  }

  stackedOn(m) {
    return new Set([...this.mrs, ...this.authored].filter((x) => x.target_branch === m.source_branch && x.iid !== m.iid).map((x) => x.iid)).size;
  }

  async loadParents(cx, mrs) {
    const branches = [...new Set(mrs.map((m) => m.target_branch))].filter((b) => b && b !== this.baseBranch() && !(b in this.stackParents));
    if (!branches.length) return;
    const found = await Promise.all(branches.map((b) => gl.forBranch(this.top, b).then((list) => list?.[0] ?? null).catch(() => null)));
    branches.forEach((b, i) => { this.stackParents[b] = found[i] && { iid: found[i].iid, title: found[i].title }; });
    cx.notify();
  }

  async loadStack(mr) {
    const below = [];
    const seen = new Set([mr.iid]);
    for (let branch = mr.target_branch; branch && branch !== this.baseBranch() && below.length < STACK_DEPTH;) {
      const parent = await gl.forBranch(this.top, branch).then((list) => list?.[0] ?? null).catch(() => null);
      if (!parent || seen.has(parent.iid)) break;
      seen.add(parent.iid);
      below.unshift(parent);
      branch = parent.target_branch;
    }
    const above = [];
    const climb = async (branch, depth) => {
      if (depth > STACK_DEPTH) return;
      const children = await gl.intoBranch(this.top, branch).catch(() => []);
      for (const child of children ?? []) {
        if (seen.has(child.iid)) continue;
        seen.add(child.iid);
        above.push({ ...child, depth });
        await climb(child.source_branch, depth + 1);
      }
    };
    await climb(mr.source_branch, 1);
    const base = below[0]?.target_branch ?? mr.target_branch;
    return below.length || above.length || mr.target_branch !== this.baseBranch() ? { base, below, above } : null;
  }

  async loadRules(cx) {
    try {
      this.config = JSON.parse((await fs.readFile(`${appHome()}/mods/gitlab-review/config.json`, "utf8").catch(() => null)) ?? "{}");
      this.rules = await fetchRules(this.config.rulesUrl);
      this.rulesError = null;
    }
    catch (e) { this.rulesError = String(e?.message ?? e); }
    cx.notify();
  }

  rulesFor(d) {
    if (!this.rules || !d) return [];
    if (d.rulesFor !== this.rules || d.rulesFiles !== d.files) {
      const paths = [...new Set(d.files.flatMap((f) => [f.new_path, f.old_path]).filter(Boolean))];
      d.rulesMatch = matchRules(this.rules, paths);
      d.rulesFor = this.rules;
      d.rulesFiles = d.files;
    }
    return d.rulesMatch;
  }

  rulesPrompt(d) {
    const matches = this.rulesFor(d);
    const mr = d.mr;
    const head = [
      `Review merge request !${mr.iid} against the team review rules below.`,
      `Read the changes with \`glab mr diff ${mr.iid}\`, and whole files with \`git fetch origin ${safeBranch(mr.source_branch)}\` then \`git show origin/${safeBranch(mr.source_branch)}:<path>\`.`,
      "For each rule, list every violation as `- path:line: <rule title>: why`, then cite the rule page. Write `No violations` for a rule with none. Findings only, no summary.",
      "Rules in mode `subagent` deserve their own sub-agent if you can run one.",
      "Do not post anything to GitLab: I add the findings I keep myself.",
    ];
    const body = matches.map(({ rule, globs, files }) => [
      `## ${rule.page_title}${rule.page_url ? ` (${rule.page_url})` : ""}`,
      `Mode: ${rule.mode}. Applies to: ${globs.join(", ")}. Files here: ${files.join(", ")}`,
      "",
      rule.body,
    ].join("\n"));
    return [...head, "", ...body].join("\n");
  }

  reviewRules(cx) {
    const d = this.details[this.iid];
    if (!d) return;
    if (!this.rules) { this.say(this.rulesError ? `Review rules unavailable: ${this.rulesError}` : "Review rules are still loading", cx, "error"); return; }
    if (!this.rulesFor(d).length) { this.say("No team review rule applies to the files of this merge request", cx); return; }
    this.askClaude(cx, d, this.rulesPrompt(d), `Asked ${this.agentName()} to review against the rules`);
  }

  async findReplies(cx, mrs) {
    const me = this.user.username;
    const candidates = mrs.filter((m) => {
      const s = this.seen[m.iid];
      return s && (m.user_notes_count ?? 0) > (s.notes ?? 0) && (this.mine[m.iid]?.commented ?? true);
    }).slice(0, 15);
    const found = await Promise.all(candidates.map(async (m) => {
      const threads = await this.call(cx, `replies:${m.iid}`, () => gl.discussions(this.top, m.iid));
      return [m.iid, threads ? repliesTo(threads, me, this.seen[m.iid]?.at).map((r) => who(r.note.author)) : []];
    }));
    this.replied = Object.fromEntries(found.filter(([, who]) => who.length));
    cx.notify();
  }

  noteMine(iid, change) {
    this.mine = { ...this.mine, [iid]: { approved: false, state: null, commented: false, ...this.mine[iid], ...change } };
  }

  async loadMr(cx, iid) {
    if (this.local) return this.loadBranch(cx);
    const [mr, files, threads, drafts, approvals, side] = await Promise.all([
      this.call(cx, `mr:${iid}`, () => gl.mergeRequest(this.top, iid)).then((mr) => {
        if (mr) this.loadStack(mr).then((stack) => { if (this.details[iid]) { this.details[iid].stack = stack; cx.notify(); } else this.pendingStack = { iid, stack }; });
        return mr;
      }),
      this.call(cx, `diffs:${iid}`, () => gl.diffs(this.top, iid)),
      this.call(cx, `threads:${iid}`, () => gl.discussions(this.top, iid)),
      this.call(cx, `drafts:${iid}`, () => gl.drafts(this.top, iid)),
      this.call(cx, `approvals:${iid}`, () => gl.approvals(this.top, iid)),
      this.call(cx, `side:${iid}`, () => gl.sidebar(this.top, this.project.path_with_namespace, iid)),
    ]);
    if (!mr) return;
    const prev = this.details[iid];
    const before = this.lastVisit[iid];
    const since = before?.sha && before.sha !== mr.sha && (!prev?.since || prev.sinceSha !== mr.sha)
      ? await this.call(cx, `since:${iid}`, () => gl.compare(this.top, before.sha, mr.sha))
      : null;
    const commits = before?.sha && before.sha !== mr.sha && prev?.commitsSha !== mr.sha
      ? await this.call(cx, `commits:${iid}`, () => gl.commits(this.top, iid))
      : null;
    if (this.iid === iid) this.markSeen(mr, cx, approvals ? Boolean(approvals.user_has_approved) : this.seen[iid]?.approved ?? false);
    this.details[iid] = {
      since: since ? new Set(since.diffs.map((x) => x.new_path)) : prev?.since ?? null,
      sinceFiles: since ? since.diffs.map((f) => ({ ...f, rows: parseDiff(f.diff), interdiff: true })) : prev?.sinceFiles ?? null,
      sinceSha: since ? mr.sha : prev?.sinceSha ?? null,
      newCommits: commits ? (commits.findIndex((c) => c.id === before.sha) >= 0 ? commits.slice(0, commits.findIndex((c) => c.id === before.sha)) : commits) : prev?.newCommits ?? [],
      commitsSha: commits ? mr.sha : prev?.commitsSha ?? null,
      events: threads ? threads.flatMap((x) => x.notes.filter((n) => n.system)) : prev?.events ?? [],
      mr,
      files: files ? files.map((f) => ({ ...f, rows: parseDiff(f.diff) })) : prev?.files ?? [],
      threads: threads ? threads.filter((d) => humanNotes(d).length) : prev?.threads ?? [],
      drafts: drafts ?? prev?.drafts ?? [],
      approvals: approvals ?? prev?.approvals ?? null,
      state: side ? mySide(side, this.user.username) : prev?.state ?? null,
      side: side ?? prev?.side ?? null,
      stack: this.pendingStack?.iid === iid ? this.pendingStack.stack : prev?.stack ?? null,
    };
    if (this.pendingStack?.iid === iid) this.pendingStack = null;
    cx.notify();
  }

  async reloadReview(cx, iid, withApprovals = true) {
    const [threads, drafts, approvals, side] = await Promise.all([
      this.call(cx, `threads:${iid}`, () => gl.discussions(this.top, iid)),
      this.call(cx, `drafts:${iid}`, () => gl.drafts(this.top, iid)),
      withApprovals ? this.call(cx, `approvals:${iid}`, () => gl.approvals(this.top, iid)) : null,
      withApprovals ? this.call(cx, `side:${iid}`, () => gl.sidebar(this.top, this.project.path_with_namespace, iid)) : undefined,
    ]);
    const d = this.details[iid];
    if (!d) return;
    if (threads) d.threads = threads.filter((x) => humanNotes(x).length);
    if (drafts) d.drafts = drafts;
    if (approvals) this.setApproved(d, iid, approvals, cx);
    if (side) { d.side = side; d.state = mySide(side, this.user.username); }
    cx.notify();
  }

  draftPayload(note) {
    const t = this.target, d = this.details[this.iid];
    if (t.kind === "line") return { note, position: position(d.mr.diff_refs ?? {}, t.file, t.row, t.fromRow ?? null) };
    if (t.kind === "reply") return { note, in_reply_to_discussion_id: t.discussionId };
    return { note };
  }

  addToReview(cx) {
    const iid = this.iid, d = this.details[iid], note = this.draft.value().trim();
    if (!d || this.sending) return;
    if (!note) { this.say("The comment is empty", cx); return; }
    if (this.local) { this.addLocalNote(note, cx); return; }
    const payload = this.draftPayload(note);
    const target = this.target;
    const temp = { id: `pending-${Date.now()}`, note: payload.note, position: payload.position ?? null, discussion_id: payload.in_reply_to_discussion_id ?? null };
    d.drafts = [...d.drafts, temp];
    this.draft.set_value("");
    this.target = GENERAL;
    this.say(`Added to your review: ${d.drafts.length} pending, nobody sees them until you submit`, cx, "success");
    cx.notify();
    cx.spawn(async (cx) => this.sendDraft(cx, iid, d, payload, temp, target));
  }

  async sendDraft(cx, iid, d, payload, temp, target) {
    try {
      const made = await gl.addDraft(this.top, iid, payload);
      d.drafts = d.drafts.map((x) => (x === temp && made?.id ? made : x));
    } catch (e) {
      d.drafts = d.drafts.filter((x) => x !== temp);
      if (!this.draft.value().trim()) { this.draft.set_value(payload.note); this.target = target; }
      this.say(`Couldn't add it, the comment is back in the box: ${e?.message ?? e}`, cx, "error");
    } finally {
      cx.notify();
    }
  }

  async removeDraft(id, cx) {
    const iid = this.iid, d = this.details[iid];
    if (!d) return;
    if (String(id).startsWith("pending-")) { this.say("Still saving that comment, try again in a second", cx); return; }
    const before = d.drafts;
    d.drafts = d.drafts.filter((x) => x.id !== id);
    this.say("Pending comment deleted", cx);
    cx.notify();
    try {
      await gl.deleteDraft(this.top, iid, id);
    } catch (e) {
      d.drafts = before;
      this.say(`Couldn't delete it, it's back: ${e?.message ?? e}`, cx, "error");
    }
    cx.notify();
  }

  async submit(then, cx, pending) {
    const iid = this.iid, d = this.details[iid];
    if (!d || this.reviewing) return;
    this.reviewing = true;
    cx.notify();
    const done = [];
    try {
      if (pending) {
        await gl.addDraft(this.top, iid, pending);
        this.draft.set_value("");
        this.target = GENERAL;
      }
      const count = d.drafts.length + (pending ? 1 : 0);
      if (count) { await gl.publishDrafts(this.top, iid); this.noteMine(iid, { commented: true }); done.push(`${count} comment${count > 1 ? "s" : ""} published`); }
      if (then === "approve") {
        const a = await gl.approve(this.top, iid);
        this.setApproved(d, iid, a?.user_has_approved === undefined ? { ...(d.approvals ?? {}), user_has_approved: true } : a, cx);
        done.push("approved");
      }
      if (then === "unapprove") {
        await gl.unapprove(this.top, iid);
        this.setApproved(d, iid, { ...(d.approvals ?? {}), user_has_approved: false }, cx);
        done.push("approval revoked");
      }
      if (then === "changes") { await gl.requestChanges(this.top, this.project.path_with_namespace, iid); d.state = "REQUESTED_CHANGES"; this.noteMine(iid, { state: "REQUESTED_CHANGES" }); done.push("changes requested"); }
      this.say(done.length ? `!${iid}: ${done.join(", ")}` : "Nothing to submit", cx, "success");
    } catch (e) {
      this.say(`${done.length ? `${done.join(", ")}, then ` : ""}failed: ${e?.message ?? e}`, cx, "error");
    } finally {
      this.reviewing = false;
      await this.reloadReview(cx, iid, !then);
      if (then) cx.timer.after(3000, (cx) => cx.spawn(async (cx) => this.reloadReview(cx, iid, true)));
    }
  }

  setApproved(d, iid, approvals, cx) {
    d.approvals = approvals;
    this.noteMine(iid, { approved: Boolean(approvals.user_has_approved) });
    if (this.seen[iid]) {
      this.seen = { ...this.seen, [iid]: { ...this.seen[iid], approved: Boolean(approvals.user_has_approved) } };
      this.persist(seenFile(), this.seen, cx);
    }
    cx.notify();
  }

  async reloadThreads(cx, iid) {
    const threads = await this.call(cx, `threads:${iid}`, () => gl.discussions(this.top, iid));
    if (threads && this.details[iid]) this.details[iid].threads = threads.filter((d) => humanNotes(d).length);
  }

  swapSearch(next) {
    const current = { query: this.query, open: this.searchOpen };
    this.query = next?.query ?? "";
    this.searchOpen = next?.open ?? false;
    this.search.set_value(this.query);
    return current;
  }

  open(iid, cx) {
    this.lastVisit[iid] = this.seen[iid] ?? null;
    this.jump = null;
    this.refsOpen = false;
    if (!this.iid) { this.listSearch = this.swapSearch(null); this.listSel = this.sel; }
    this.iid = iid;
    this.tab = "description";
    this.fullDiff = false;
    this.file = 0;
    this.area = "files";
    this.cursor = null;
    this.mark = null;
    this.ds = null;
    this.target = GENERAL;
    this.draft.set_value("");
    this.handle.focus();
    cx.spawn(async (cx) => this.loadMr(cx, iid));
    cx.notify();
  }

  back(cx) {
    if (this.local) return;
    const iid = this.iid;
    this.iid = null;
    this.peoplePick = null;
    this.target = GENERAL;
    this.refsOpen = false;
    this.swapSearch(this.listSearch);
    this.listSearch = null;
    this.sel = this.listSel ?? this.sel;
    this.handle.focus();
    if (iid) cx.spawn(async (cx) => { const mr = await this.call(cx, `mr:${iid}`, () => gl.mergeRequest(this.top, iid)); if (mr) this.markSeen(mr, cx); });
    cx.notify();
  }

  dismiss() {
    const o = props()?.overlay;
    if (o) closeOverlay(o);
  }

  setTab(tab, cx) {
    this.tab = tab;
    cx.notify();
  }

  projectUrl(d) { return String(d?.mr?.web_url ?? "").replace(/\/-\/merge_requests\/\d+$/, ""); }

  markdownView(t, key, text, d) {
    const view = (k, md) => TextView.markdown(k, gitlabLinks(md, this.projectUrl(d))).selectable().on_link_click((url, cx) => this.openLink(url, cx));
    return splitDetails(String(text ?? "")).map((seg, n) => {
      if (seg.kind === "md") return view(`${key}-${n}`, seg.text);
      const id = `${key}-${n}`, open = this.openDetails.has(id);
      return v_flex().w_full().gap(6)
        .child(h_flex().id(`det-${id}`).gap(6).items_center().cursor_pointer().text_size(12.5).text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => { if (open) this.openDetails.delete(id); else this.openDetails.add(id); cx.notify(); })
          .child(div().w(12).flex_none().child(open ? "▾" : "▸")).child(seg.summary))
        .when(open, (el) => el.child(div().pl(18).child(view(`${id}-body`, seg.text))));
    });
  }

  openLink(url, cx) {
    const linear = String(url).match(/^https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/);
    if (linear) {
      openOverlay({ mod: "linear", kind: "window", key: "linear-link", width: 980, height: 0.8, props: { open: linear[1].toUpperCase() } });
      return;
    }
    if (/^https?:\/\//i.test(String(url))) cx.open_url(url);
  }

  editDescription(cx) {
    const d = this.details[this.iid];
    if (!d || d.mr.state === "local") return;
    this.descEdit = { iid: this.iid, original: d.mr.description ?? "" };
    this.descText = d.mr.description ?? "";
    this.mention = null;
    this.descDraft.set_value(this.descText);
    this.tab = "description";
    cx.timer.after(0, () => this.descDraft.focus());
    cx.notify();
  }

  cancelDescription(cx) {
    this.descEdit = null;
    this.handle.focus();
    cx.notify();
  }

  saveDescription(cx) {
    const e = this.descEdit;
    if (!e || this.savingDesc) return;
    const text = this.descDraft.value();
    if (text === e.original) { this.cancelDescription(cx); return; }
    const d = this.details[e.iid];
    this.savingDesc = true;
    if (d) d.mr = { ...d.mr, description: text };
    this.descEdit = null;
    this.handle.focus();
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await gl.setDescription(this.top, e.iid, text);
        this.say(`Description of !${e.iid} saved`, cx, "success");
      } catch (err) {
        if (d && d.mr.description === text) d.mr = { ...d.mr, description: e.original };
        this.descEdit = e;
        this.descText = text;
        this.descDraft.set_value(text);
        this.tab = "description";
        this.say(`Couldn't save the description, it's back in the editor: ${err?.message ?? err}`, cx, "error");
      } finally {
        this.savingDesc = false;
        cx.notify();
      }
    });
  }

  trackMention(cx) {
    const text = this.descDraft.value(), prev = this.descText ?? "";
    this.descText = text;
    const at = text === prev ? null : mentionAt(text, editPoint(prev, text));
    this.mention = at ? { ...at, sel: this.mention?.query === at.query ? this.mention.sel : 0, found: this.mention?.found ?? [] } : null;
    if (!at || at.query.length < 2) return;
    const gen = (this.mentionGen = (this.mentionGen ?? 0) + 1);
    cx.timer.after(250, (cx) => {
      if (gen !== this.mentionGen) return;
      cx.spawn(async (cx) => {
        const list = await gl.users(this.top, at.query).catch(() => null);
        if (gen !== this.mentionGen || !this.mention || !Array.isArray(list)) return;
        this.mention.found = list.map((u) => ({ username: u.username, name: u.name }));
        cx.notify();
      });
    });
  }

  mentionChoices() {
    if (!this.mention) return [];
    const s = this.details[this.iid]?.side;
    const near = s ? [...s.participants, ...s.reviewers, ...s.assignees] : [];
    const seen = new Set();
    const people = [...near, ...(this.mention.found ?? [])]
      .filter((u) => u?.username && !seen.has(u.username) && seen.add(u.username))
      .map((u) => ({ id: u.username, name: u.name ?? u.username, displayName: u.username }));
    return rankPeople(people, this.mention.query, new Set(near.map((u) => u.username)));
  }

  pickMention(p, cx) {
    if (!this.mention || !p) return;
    const { text, cursor } = insertMention(this.descDraft.value(), this.mention, p.displayName);
    this.mention = null;
    this.descText = text;
    this.descDraft.set_value(text);
    this.descDraft.set_selected_range({ start: cursor, end: cursor });
    this.descDraft.focus();
    cx.notify();
  }

  mentionKey(k, cx) {
    const list = this.mentionChoices();
    if (!list.length) return false;
    if (k === "down" || k === "up") {
      this.mention.sel = (this.mention.sel + (k === "down" ? 1 : list.length - 1)) % list.length;
      cx.notify();
      return true;
    }
    if (k === "enter" || k === "tab") { this.pickMention(list[Math.min(this.mention.sel, list.length - 1)], cx); return true; }
    if (k === "escape") { this.mention = null; cx.notify(); return true; }
    return false;
  }

  mentionList(t) {
    const list = this.mentionChoices(), sel = Math.min(this.mention.sel, list.length - 1);
    return v_flex().w_full().p(4).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover)
      .children(list.map((p, n) => h_flex().id(`mn-${p.id}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .bg(n === sel ? t.selected : t.popover).hover((s) => s.bg(n === sel ? t.selected : t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.pickMention(p, cx))
        .child(this.avatar(t, p.name, 18))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(p.name))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`@${p.displayName}`))))
      .child(div().px(8).pt(2).text_size(10.5).text_color(t.dim).child("↑↓ choose · Enter or Tab to mention · Esc"));
  }

  descriptionEditor(t, d) {
    const changed = this.descDraft.value() !== this.descEdit.original;
    return v_flex().id("glr-desc-edit").flex_1().min_h(0).p(16).pb(120).gap(12).overflow_y_scrollbar()
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(12.5).font_semibold().child(`Editing the description of !${d.mr.iid}`))
        .child(this.button(t, "de-cancel", "Cancel", (cx) => this.cancelDescription(cx)))
        .child(this.button(t, "de-save", this.savingDesc ? "Saving…" : "Save  ⌘↵", (cx) => this.saveDescription(cx), true, changed && !this.savingDesc)))
      .when(this.mentionChoices().length > 0, (el) => el.child(this.mentionList(t)))
      .child(div().id("de-area").w_full().min_w(0).rounded(8).border_1().border_color(this.descFocused ? t.accent : t.border).bg(t.background)
        .on_mouse_down("left", stop).child(Textarea.new(this.descDraft).w_full()))
      .child(div().text_size(11).font_semibold().text_color(t.dim).child("PREVIEW"))
      .child(v_flex().w_full().gap(10).p(12).rounded(8).border_1().border_color(t.border)
        .children(this.markdownView(t, `de-prev-${d.mr.iid}`, this.descDraft.value().trim() || "_No description_", d)));
  }

  aim(target, cx) {
    this.target = target;
    cx.timer.after(0, () => this.draft.focus());
    cx.notify();
  }

  targetLabel() {
    const t = this.target;
    if (t.kind === "reply") return `Reply to ${t.who}`;
    if (t.kind === "line") return t.fromRow ? `Lines ${t.file.new_path}:${t.fromRow.new ?? t.fromRow.old}–${t.row.new ?? t.row.old}` : `Line ${t.file.new_path}:${t.row.new ?? t.row.old}`;
    return this.local ? "General comment" : "Comment on the merge request";
  }

  post(cx) {
    const iid = this.iid, d = this.details[iid], body = this.draft.value().trim(), t = this.target;
    if (!d || this.sending || (this.local && !this.remote)) return;
    if (!body) { this.say("The comment is empty", cx); return; }
    this.sending = true;
    cx.notify();
    cx.spawn(async (cx) => this.sendPost(cx, iid, d, body, t));
  }

  async sendPost(cx, iid, d, body, t) {
    try {
      if (t.kind === "line") await gl.lineComment(this.top, iid, d.mr.diff_refs, t.file, t.row, body, t.fromRow ?? null);
      else if (t.kind === "reply") await gl.reply(this.top, iid, t.discussionId, body);
      else await gl.comment(this.top, iid, body);
      this.draft.set_value("");
      this.target = GENERAL;
      this.noteMine(iid, { commented: true });
      this.say("Posted on GitLab", cx, "success");
      await this.reloadThreads(cx, iid);
    } catch (e) {
      this.say(`Couldn't post: ${e?.message ?? e}`, cx, "error");
    } finally {
      this.sending = false;
      cx.notify();
    }
  }

  closable() {
    const mr = this.local ? this.remote : this.details[this.iid]?.mr;
    return mr?.iid && mr.state !== "local" ? { iid: mr.iid, state: mr.state } : null;
  }

  setMrState(event, cx, comment = null) {
    const iid = this.closable()?.iid;
    if (!iid || this.closing) return;
    this.closing = true;
    this.say(event === "reopen" ? `Reopening !${iid}…` : comment ? `Commenting and closing !${iid}…` : `Closing !${iid}…`, cx);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (comment) {
          await gl.comment(this.top, iid, comment);
          this.draft.set_value("");
          this.target = GENERAL;
          this.noteMine(iid, { commented: true });
        }
        const was = this.details[iid]?.mr?.state;
        this.patchMr(iid, (m) => (m && m.iid === iid ? { ...m, state: event === "reopen" ? "opened" : "closed" } : m));
        this.say(event === "reopen" ? `Reopened !${iid}` : comment ? `Commented and closed !${iid}` : `Closed !${iid}`, cx, "success");
        cx.notify();
        try {
          await gl.setState(this.top, iid, event);
        } catch (e) {
          this.patchMr(iid, (m) => (m && m.iid === iid ? { ...m, state: was ?? m.state } : m));
          throw e;
        }
        this.refresh(cx);
      } catch (e) {
        this.say(`Couldn't ${event} !${iid}: ${e?.message ?? e}`, cx, "error");
      } finally {
        this.closing = false;
        cx.notify();
      }
    });
  }

  isDraft(mr) {
    return Boolean(mr?.draft || mr?.work_in_progress);
  }

  draftable() {
    const mr = this.local ? this.remote && this.details[this.iid]?.mr : this.details[this.iid]?.mr;
    return mr?.iid && mr.state === "opened" ? mr : null;
  }

  patchMr(iid, change) {
    for (const d of Object.values(this.details)) if (d?.mr?.iid === iid) d.mr = change(d.mr);
    if (this.remote?.iid === iid) this.remote = change(this.remote);
    this.mrs = this.mrs.map(change);
    this.authored = this.authored.map(change);
  }

  toggleDraft(cx) {
    const mr = this.draftable();
    if (!mr || this.drafting || !this.project) return;
    const draft = !this.isDraft(mr), iid = mr.iid;
    this.drafting = true;
    const flip = (on) => (m) => (m && m.iid === iid ? { ...m, draft: on, work_in_progress: on, title: on ? `Draft: ${m.title.replace(DRAFT_PREFIX, "")}` : m.title.replace(DRAFT_PREFIX, "") } : m);
    this.patchMr(iid, flip(draft));
    this.say(draft ? `!${iid} is a draft now` : `!${iid} is ready`, cx, "success");
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await gl.setDraft(this.top, this.project.path_with_namespace, iid, draft);
        this.refresh(cx);
      } catch (e) {
        this.patchMr(iid, flip(!draft));
        this.say(`Couldn't change the draft status of !${iid}: ${e?.message ?? e}`, cx, "error");
      } finally {
        this.drafting = false;
        cx.notify();
      }
    });
  }

  openPeople(kind, cx) {
    if (this.peoplePick?.kind === kind) { this.closePeople(cx); return; }
    this.peoplePick = { kind, sel: 0, found: null };
    this.peopleInput.set_value("");
    cx.timer.after(0, () => this.peopleInput.focus());
    cx.notify();
  }

  closePeople(cx) {
    this.peoplePick = null;
    this.handle.focus();
    cx.notify();
  }

  peopleChoices() {
    const p = this.peoplePick, s = this.details[this.iid]?.side;
    if (!p || !s) return [];
    const on = new Set(s[p.kind].map((u) => u.username));
    const q = this.peopleInput.value().trim().toLowerCase();
    const near = [...s[p.kind], ...(this.user ? [this.user] : []), ...s.participants, ...s.assignees, ...s.reviewers];
    const pool = q && p.found ? [...p.found, ...near] : near;
    const seen = new Set();
    return pool.filter((u) => u?.username && !seen.has(u.username) && seen.add(u.username))
      .filter((u) => !q || `${u.username} ${u.name ?? ""}`.toLowerCase().includes(q))
      .map((u) => ({ username: u.username, name: u.name ?? u.username, on: on.has(u.username) }))
      .slice(0, 12);
  }

  searchPeople(cx) {
    const p = this.peoplePick;
    if (!p) return;
    p.sel = 0;
    const q = this.peopleInput.value().trim();
    const gen = (this.peopleGen = (this.peopleGen ?? 0) + 1);
    cx.notify();
    if (q.length < 2) return;
    cx.timer.after(250, (cx) => {
      if (gen !== this.peopleGen) return;
      cx.spawn(async (cx) => {
        const list = await gl.users(this.top, q).catch(() => null);
        if (gen !== this.peopleGen || !this.peoplePick || !Array.isArray(list)) return;
        this.peoplePick.found = list.map((u) => ({ username: u.username, name: u.name }));
        cx.notify();
      });
    });
  }

  togglePerson(kind, u, cx) {
    const mr = this.draftable();
    if (!u || this.peopleBusy || !mr || !this.project) return;
    this.peopleBusy = u.username;
    const what = kind === "reviewers" ? "reviewer" : "assignee";
    const d = this.details[this.iid];
    const before = d?.side;
    if (d?.side) {
      const list = d.side[kind] ?? [];
      d.side = { ...d.side, [kind]: u.on ? list.filter((x) => x.username !== u.username) : [...list, { username: u.username, name: u.name, state: null, approved: false }] };
    }
    this.say(u.on ? `${u.name} is no longer ${what} of !${mr.iid}` : `${u.name} is ${what} of !${mr.iid}`, cx, "success");
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await gl.setPeople(this.top, this.project.path_with_namespace, mr.iid, kind, [u.username], u.on ? "REMOVE" : "APPEND");
        const side = await gl.sidebar(this.top, this.project.path_with_namespace, mr.iid).catch(() => null);
        if (d && side) { d.side = side; d.state = mySide(side, this.user?.username); }
      } catch (e) {
        if (d) d.side = before;
        this.say(`Couldn't change the ${what}s of !${mr.iid}: ${e?.message ?? e}`, cx, "error");
      } finally {
        this.peopleBusy = null;
        cx.notify();
      }
    });
  }

  peopleKey(k, cx) {
    const list = this.peopleChoices();
    if (k === "escape") { this.closePeople(cx); return true; }
    if ((k === "down" || k === "up") && list.length) {
      this.peoplePick.sel = (Math.min(this.peoplePick.sel, list.length - 1) + (k === "down" ? 1 : list.length - 1)) % list.length;
      cx.notify();
      return true;
    }
    return false;
  }

  peoplePicker(t) {
    const p = this.peoplePick, list = this.peopleChoices(), sel = Math.min(p.sel, list.length - 1);
    const q = this.peopleInput.value().trim();
    return v_flex().w_full().gap(1).p(4).rounded(8).border_1().border_color(t.border).bg(t.popover)
      .child(h_flex().h(28).px(8).mb(2).items_center().rounded(6).border_1().border_color(this.peopleFocused ? t.accent : t.border).bg(t.background)
        .on_mouse_down("left", stop).child(Input.new(this.peopleInput).flex_1().h_full().text_size(12)))
      .children(list.map((u, n) => h_flex().id(`pp-${u.username}`).w_full().h(26).px(6).gap(8).items_center().rounded(6).cursor_pointer()
        .bg(n === sel ? t.selected : t.popover).hover((s) => s.bg(n === sel ? t.selected : t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.togglePerson(p.kind, u, cx))
        .child(div().w(12).flex_none().text_size(11).text_color(t.accent).child(this.peopleBusy === u.username ? "…" : u.on ? "✓" : ""))
        .child(this.avatar(t, u.name, 18))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(u.username === this.user?.username ? t.accent : t.foreground).child(u.name))
        .child(div().flex_none().max_w(90).truncate().text_size(10.5).text_color(t.dim).child(`@${u.username}`))))
      .when(!list.length, (el) => el.child(div().px(6).py(4).text_size(11.5).text_color(t.dim).child(q.length < 2 ? "Type a name" : "Nobody matches")))
      .child(div().px(6).pt(2).text_size(10.5).text_color(t.dim).child("↑↓ choose · Enter add or remove · Esc close"));
  }

  draftButton(t) {
    const mr = this.draftable();
    if (!mr) return null;
    const label = this.drafting ? "Saving…" : this.isDraft(mr) ? "Mark as ready  ⇧D" : "Mark as draft  ⇧D";
    return this.button(t, "h-draft", label, (cx) => this.toggleDraft(cx), false, !this.drafting);
  }

  statePill(t, mr) {
    const [text, color] = MR_STATE[mr.state === "opened" && this.isDraft(mr) ? "draft" : mr.state] ?? [mr.state, t.dim];
    return div().flex_none().h(20).px(8).rounded(10).bg(color).text_size(11).font_semibold().text_color("#ffffff").flex().items_center().child(text);
  }

  copy(text, cx) {
    cx.write_to_clipboard(text);
    this.toast(`Copied ${text}`, cx);
  }

  toast(text, cx) {
    this.toastText = text;
    const gen = (this.toastGen = (this.toastGen ?? 0) + 1);
    cx.notify();
    cx.timer.after(2200, (cx) => { if (gen === this.toastGen) { this.toastText = null; cx.notify(); } });
  }

  toastView(t) {
    return div().absolute().bottom(44).left(0).right(0).flex().justify_center()
      .child(h_flex().h(34).px(16).gap(8).items_center().rounded(17).bg(t.done).text_size(13).font_semibold().text_color("#ffffff")
        .child("✓").child(this.toastText));
  }

  context() {
    const t = this.target;
    if (t.kind === "line") {
      const n = t.fromRow ? `${t.fromRow.new ?? t.fromRow.old}-${t.row.new ?? t.row.old}` : t.row.new ?? t.row.old;
      return `About ${t.file.new_path}:${n} (${t.row.kind === "del" ? "removed line" : t.row.kind === "add" ? "added line" : "unchanged line"}):\n\`\`\`\n${excerpt(t.file.rows, t.index)}\n\`\`\``;
    }
    if (t.kind === "reply") {
      const d = this.details[this.iid]?.threads.find((x) => x.id === t.discussionId);
      const notes = d ? humanNotes(d).map((n) => `${who(n.author)}: ${n.body}`).join("\n\n") : "";
      return notes ? `About this review thread:\n${notes}` : "";
    }
    return "";
  }

  askAboutReview(cx) {
    const d = this.details[this.iid];
    if (!d?.drafts.length) { this.say("Your review is empty: add comments first (⌘↵)", cx); return; }
    this.askClaude(cx, d, draftsQuestion({ iid: d.mr.iid }, d.drafts, this.allFiles(d), d.threads), `Asked ${this.agentName()} about your review`);
  }

  brief(mr) {
    const rules = this.rulesFor(this.details[mr.iid]);
    return [
      `You are helping me review GitLab merge request !${mr.iid} in this repository: ${mr.title}`,
      mr.web_url,
      `Branch ${mr.source_branch} into ${mr.target_branch}, by ${who(mr.author)}.`,
      "",
      "Rules: answer me here, in this terminal. Never post comments, approvals or anything else to GitLab, never edit files, and never check out, switch or commit.",
      `Read what you need with \`glab mr view ${mr.iid} --comments\`, \`glab mr diff ${mr.iid}\`, and \`git fetch origin ${safeBranch(mr.source_branch)}\` then \`git show origin/${safeBranch(mr.source_branch)}:<path>\` for whole files.`,
      ...(rules.length ? ["", "Team review rules that apply to this merge request (I may ask you to review against them):",
        ...rules.map(({ rule, globs }) => `- ${rule.page_title}${rule.page_url ? ` (${rule.page_url})` : ""}: ${globs.join(", ")}`)] : []),
    ].join("\n");
  }

  agentName() {
    return agentName(this.config);
  }

  claudeAlive() {
    return Boolean(this.claude) && terminals().some((x) => x.address === this.claude && x.state === "live");
  }

  claudeShown() {
    return panes().some((p) => p.terminal === this.claude);
  }

  wait(cx, ms) {
    return new Promise((resolve) => cx.timer.after(ms, () => resolve()));
  }

  async showClaude(cx) {
    return this.showRight(cx, this.claude);
  }

  async showRight(cx, address) {
    const live = () => terminals().some((x) => x.address === address && x.state === "live");
    const shown = () => panes().some((p) => p.terminal === address);
    for (let n = 0; n < 40 && !shown(); n++) {
      if (n % 4 === 0 && live()) run("terminal.keep", { terminal: address, place: "right" });
      await this.wait(cx, 250);
    }
    return shown();
  }

  async handToClaude(text, cx) {
    const alive = this.fixer && terminals().some((x) => x.address === this.fixer && x.state === "live");
    if (alive) {
      const r = await hc(["send", this.fixer, text]);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout || "").trim() || "hc send failed");
      await this.showRight(cx, this.fixer);
      return;
    }
    const name = `branch-review-${Date.now().toString(36)}`;
    const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name, "--cwd", this.top, "--", ...agentArgv(this.config), text]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
    this.fixer = JSON.parse(r.stdout).address ?? name;
    await this.showRight(cx, this.fixer);
  }

  async launchClaude(text) {
    const name = `mr-review-${Date.now().toString(36)}`;
    const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name, "--cwd", this.top, "--", ...askArgv(this.config, DENY), text]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
    return JSON.parse(r.stdout).address ?? name;
  }

  ask(cx) {
    const d = this.details[this.iid], q = this.draft.value().trim();
    if (!d || this.local) return;
    if (!q) { this.say("Type a question first", cx); return; }
    const ctx = this.context();
    if (this.askClaude(cx, d, ctx ? `${q}\n\n${ctx}` : q, `Asked ${this.agentName()}`)) this.draft.set_value("");
  }

  askClaude(cx, d, question, done) {
    if (Date.now() - this.askedAt < 800) return false;
    this.askedAt = Date.now();
    const iid = d.mr.iid;
    const here = focused()?.pane ?? null;
    cx.spawn(async (cx) => {
      try {
        if (this.claudeAlive()) {
          const text = this.briefed.has(iid) ? `[MR !${iid}] ${question}` : `${this.brief(d.mr)}\n\nMy question: ${question}`;
          if (!this.claudeShown()) await this.showClaude(cx);
          const r = await hc(["send", this.claude, text]);
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        } else {
          this.claude = await this.launchClaude(`${this.brief(d.mr)}\n\nMy question: ${question}`);
          this.briefed = new Set();
        }
        this.briefed.add(iid);
        const shown = await this.showClaude(cx);
        if (here) run("pane.focus", { pane: here });
        this.say(shown ? `${done}: the answer comes in the pane on the right · g to jump there`
          : `${done}, still starting in the background · g to show its pane`, cx, "success");
      } catch (e) {
        this.askedAt = 0;
        this.say(`Couldn't reach ${this.agentName()}: ${e?.message ?? e}`, cx, "error");
      }
      cx.notify();
    });
    return true;
  }

  openClaude(cx) {
    const d = this.details[this.iid];
    if (!d || Date.now() - this.askedAt < 800) return;
    this.askedAt = Date.now();
    const iid = d.mr.iid;
    cx.spawn(async (cx) => {
      try {
        let term;
        if (this.local) {
          const alive = this.fixer && terminals().some((x) => x.address === this.fixer && x.state === "live");
          if (alive) await this.showRight(cx, this.fixer);
          else await this.handToClaude(`We work together on branch ${d.mr.source_branch}${d.base ? ` against ${d.base}` : ""} in this repository. I review its changes in Herdr and send you my comments and questions here. Wait for my first message.`, cx);
          term = this.fixer;
        } else {
          if (!this.claudeAlive()) {
            this.claude = await this.launchClaude(`${this.brief(d.mr)}\n\nRead it, then wait for my questions.`);
            this.briefed = new Set([iid]);
          } else if (!this.briefed.has(iid)) {
            const r = await hc(["send", this.claude, `${this.brief(d.mr)}\n\nRead it, then wait for my questions.`]);
            if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
            this.briefed.add(iid);
          }
          await this.showClaude(cx);
          term = this.claude;
        }
        const shown = panes().some((p) => p.terminal === term);
        if (shown) run("pane.focus", { terminal: term });
        this.say(shown ? (this.local ? `${this.agentName()} is on the right: a sends your review there too` : `${this.agentName()} is on the right: ⌥↵ questions and rule reviews go there too`)
          : `${this.agentName()} is starting in the background · g to show its pane`, cx, "success");
      } catch (e) {
        this.askedAt = 0;
        this.say(`Couldn't reach ${this.agentName()}: ${e?.message ?? e}`, cx, "error");
      }
      cx.notify();
    });
  }

  onKey(e, cx) {
    const k = e.keystroke.replace(/(^|-)fn-/, "$1");
    if (k === "cmd-r") { this.reload(cx); cx.stop_propagation(); return; }
    if (this.editorMenu && k === "escape") { this.toggleEditorMenu(cx); cx.stop_propagation(); return; }
    if (this.peopleFocused || (this.peoplePick && k === "escape")) {
      if (this.peopleKey(k, cx)) cx.stop_propagation();
      return;
    }
    if (this.searchFocused) {
      if (k === "escape") { this.closeSearch(cx); cx.stop_propagation(); }
      else if (k === "down" || k === "up") { this.handle.focus(); cx.notify(); }
      return;
    }
    if (this.descFocused) {
      if (this.mentionKey(k, cx)) { cx.stop_propagation(); return; }
      if (k === "cmd-enter" || k === "ctrl-enter") { this.saveDescription(cx); cx.stop_propagation(); }
      else if (k === "escape") { this.handle.focus(); cx.stop_propagation(); }
      return;
    }
    if (k === "/" || k === "cmd-f" || k === "ctrl-f") { this.openSearch(cx); cx.stop_propagation(); return; }
    if (this.composing) {
      if (k === "cmd-enter" || k === "ctrl-enter") { this.addToReview(cx); cx.stop_propagation(); }
      else if (k === "alt-enter") { this.ask(cx); cx.stop_propagation(); }
      else if (k === "escape") { this.handle.focus(); cx.stop_propagation(); }
      return;
    }
    if (k === "escape" && (this.query || this.searchOpen)) { this.closeSearch(cx); cx.stop_propagation(); return; }
    const shown = this.listed();
    const inCode = this.iid && this.tab === "changes" && this.area === "code";
    const keys = this.iid ? {
      escape: () => (inCode && this.mark !== null ? this.clearMark(cx) : inCode ? this.leaveCode(cx) : this.target !== GENERAL ? this.aim(GENERAL, cx) : this.back(cx)),
      backspace: () => this.back(cx),
      a: () => this.local && this.sendLocal(cx),
      r: () => this.reload(cx),
      1: () => this.setTab("description", cx), 2: () => this.setTab("changes", cx), 3: () => this.setTab("comments", cx), 4: () => this.setTab("review", cx),
      tab: () => this.setTab(TABS[(TABS.indexOf(this.tab) + 1) % TABS.length], cx),
      "shift-tab": () => this.setTab(TABS[(TABS.indexOf(this.tab) + TABS.length - 1) % TABS.length], cx),
      down: () => this.tab === "changes" && (inCode ? this.moveCursor(1, cx) : this.moveFile(1, cx)),
      up: () => this.tab === "changes" && (inCode ? this.moveCursor(-1, cx) : this.moveFile(-1, cx)),
      "shift-down": () => inCode && this.moveCursor(1, cx, true),
      "shift-up": () => inCode && this.moveCursor(-1, cx, true),
      "ctrl-down": () => inCode && this.moveCursor(CODE_JUMP, cx),
      "ctrl-up": () => inCode && this.moveCursor(-CODE_JUMP, cx),
      "ctrl-shift-down": () => inCode && this.moveCursor(CODE_JUMP, cx, true),
      "ctrl-shift-up": () => inCode && this.moveCursor(-CODE_JUMP, cx, true),
      right: () => this.tab === "changes" && !inCode && this.enterCode(cx),
      left: () => inCode && this.leaveCode(cx),
      pagedown: () => inCode && this.moveCursor(CODE_JUMP, cx),
      pageup: () => inCode && this.moveCursor(-CODE_JUMP, cx),
      "shift-pagedown": () => inCode && this.moveCursor(CODE_JUMP, cx, true),
      "shift-pageup": () => inCode && this.moveCursor(-CODE_JUMP, cx, true),
      "alt-down": () => inCode && this.moveCursor(CODE_JUMP, cx),
      "alt-up": () => inCode && this.moveCursor(-CODE_JUMP, cx),
      "alt-shift-down": () => inCode && this.moveCursor(CODE_JUMP, cx, true),
      "alt-shift-up": () => inCode && this.moveCursor(-CODE_JUMP, cx, true),
      space: () => inCode && this.moveCursor(this.codePage(), cx),
      "shift-space": () => inCode && this.moveCursor(-this.codePage(), cx),
      c: () => (inCode && this.cursor !== null ? this.aimCursor(cx) : this.aim(this.target, cx)),
      g: () => this.openClaude(cx),
      i: () => !this.local && this.toggleIgnore(this.iid, cx),
      o: () => this.details[this.iid]?.mr.web_url && cx.open_url(this.details[this.iid].mr.web_url),
      e: () => (this.editors?.includes(HERDR_EDITOR) ? this.openEditor(HERDR_EDITOR, cx) : this.editor ? this.openEditor(this.editor, cx) : this.toggleEditorMenu(cx)),
      "shift-e": () => this.toggleEditorMenu(cx),
      s: () => this.tab === "changes" && this.toggleSplit(cx),
      d: () => this.tab === "description" && this.editDescription(cx),
      "shift-d": () => this.toggleDraft(cx),
      y: () => { const f = this.tab === "changes" && this.currentFile(); if (f) this.copy(f.new_path, cx); },
      q: () => this.dismiss(),
    } : {
      escape: () => { if (this.anchor !== null && this.anchor !== undefined) { this.anchor = null; cx.notify(); } else this.dismiss(); },
      q: () => this.dismiss(),
      down: () => { this.anchor = null; this.sel = Math.min(shown.length - 1, this.sel + 1); cx.notify(); },
      up: () => { this.anchor = null; this.sel = Math.max(0, this.sel - 1); cx.notify(); },
      "shift-down": () => this.extend(1, cx),
      "shift-up": () => this.extend(-1, cx),
      enter: () => shown[this.sel] && this.open(shown[this.sel].m.iid, cx),
      i: () => this.ignorePicked(cx),
      m: () => this.toggleMerged(cx),
      1: () => this.setListTab("mine", cx), 2: () => this.setListTab("review", cx), 3: () => this.setListTab("ignored", cx), 4: () => this.setListTab("merged", cx),
      tab: () => this.setListTab(LIST_TABS[(LIST_TABS.indexOf(this.listTab) + 1) % LIST_TABS.length], cx),
      "shift-tab": () => this.setListTab(LIST_TABS[(LIST_TABS.indexOf(this.listTab) + LIST_TABS.length - 1) % LIST_TABS.length], cx),
      r: () => this.reload(cx),
    };
    if (!keys[k]) return;
    keys[k]();
    cx.stop_propagation();
  }

  moveFile(delta, cx) {
    const d = this.details[this.iid];
    const list = d ? this.shownFiles(d) : [];
    if (!list.length) return;
    const at = list.findIndex((x) => x.index === this.file);
    this.file = list[Math.max(0, Math.min(list.length - 1, at + delta))].index;
    this.cursor = null;
    cx.notify();
  }

  currentFile() {
    const d = this.details[this.iid];
    if (!d) return null;
    const shown = this.shownFiles(d);
    return (shown.find((x) => x.index === this.file) ?? shown[0])?.f ?? null;
  }

  shownDiff() {
    const d = this.details[this.iid];
    if (!d || this.tab !== "changes") return null;
    const shown = this.shownFiles(d);
    const file = (shown.find((x) => x.index === this.file) ?? shown[0])?.f;
    if (!file?.rows?.length || file.too_large || file.collapsed) return null;
    const jump = this.jump?.file === file ? this.jump.index : null;
    const start = jump === null ? 0 : Math.max(0, jump - JUMP_ABOVE);
    return { file, start, end: Math.min(file.rows.length, start + MAX_ROWS) };
  }

  diffScroll(key) {
    if (this.ds?.key !== key) this.ds = { key, y: 0, view: 0, content: 0, h: {}, tops: {}, follow: null };
    return this.ds;
  }

  scrollDiff(dy, cx) {
    const S = this.ds;
    if (!S) return;
    const next = Math.max(0, Math.min(Math.max(0, S.content - S.view), S.y + dy));
    if (Math.abs(next - S.y) < 0.5) return;
    S.y = next;
    if (this.area === "code") this.keepCursorOnScreen();
    cx.notify();
  }

  margin() { return Math.max(CODE_MARGIN, (this.ds?.view ?? 0) * 0.25); }

  keepCursorOnScreen() {
    const S = this.ds, v = this.shownDiff();
    if (!S || !v || this.cursor === null) return;
    const top = (i) => S.tops[S.keyOf?.[i] ?? `r${i}`];
    const h = (i) => S.h[S.keyOf?.[i] ?? `r${i}`] ?? CODE_ROW;
    const inView = (i) => top(i) !== undefined && top(i) >= S.y && top(i) + h(i) <= S.y + S.view;
    if (inView(this.cursor)) return;
    const code = [];
    for (let i = v.start; i < v.end; i++) if (v.file.rows[i].kind !== "hunk" && inView(i)) code.push(i);
    if (!code.length) return;
    this.mark = null;
    this.cursor = top(this.cursor) < S.y ? code[0] : code[code.length - 1];
  }

  codePage() { return Math.max(1, Math.floor((this.ds?.view ?? 0) / CODE_ROW) - 3); }

  reveal(index) {
    const S = this.ds, key = S?.keyOf?.[index] ?? `r${index}`;
    if (S) S.follow = index;
    if (!S || S.tops[key] === undefined) return;
    const top = S.tops[key], h = S.h[key] ?? CODE_ROW, m = this.margin();
    if (top - m < S.y) S.y = Math.max(0, top - m);
    else if (top + h + m > S.y + S.view) S.y = Math.min(Math.max(0, S.content - S.view), top + h + m - S.view);
  }

  moveCursor(delta, cx, extend = false) {
    const v = this.shownDiff();
    if (!v) return;
    if (extend && this.mark === null) this.mark = this.cursor;
    if (!extend) this.mark = null;
    const { file, start, end } = v;
    const code = (i) => i >= start && i < end && file.rows[i].kind !== "hunk";
    if (this.split) {
      const pairs = splitRows(file.rows, start, end).filter((x) => x.hunk === undefined);
      if (!pairs.length) return;
      const lead = (x) => x.right ?? x.left;
      const at = pairs.findIndex((x) => x.left === this.cursor || x.right === this.cursor);
      const next = at < 0 ? 0 : Math.max(0, Math.min(pairs.length - 1, at + delta));
      this.cursor = at >= 0 && next === at ? this.cursor : lead(pairs[next]);
      this.reveal(this.cursor);
      cx.notify();
      return;
    }
    let i = this.cursor !== null && code(this.cursor) ? this.cursor : null;
    if (i === null) {
      i = start;
      while (i < end && !code(i)) i++;
      if (i >= end) return;
    } else {
      const step = Math.sign(delta);
      for (let left = Math.abs(delta); left > 0; left--) {
        let j = i + step;
        while (j >= start && j < end && !code(j)) j += step;
        if (!code(j)) break;
        i = j;
      }
    }
    this.cursor = i;
    this.reveal(i);
    cx.notify();
  }

  enterCode(cx) {
    const v = this.shownDiff();
    if (!v) return;
    this.area = "code";
    const S = this.ds;
    const visible = (i) => (S?.tops[S?.keyOf?.[i] ?? `r${i}`] ?? 0) >= (S?.y ?? 0);
    if (this.cursor === null || this.cursor < v.start || this.cursor >= v.end || !visible(this.cursor)) {
      let i = v.start;
      while (i < v.end && (v.file.rows[i].kind === "hunk" || !visible(i))) i++;
      this.cursor = i < v.end ? i : null;
    }
    if (this.cursor === null) this.moveCursor(1, cx);
    else { this.reveal(this.cursor); cx.notify(); }
  }

  leaveCode(cx) {
    this.area = "files";
    this.mark = null;
    cx.notify();
  }

  clearMark(cx) {
    this.mark = null;
    cx.notify();
  }

  codeRange() {
    if (this.cursor === null) return null;
    const a = this.mark ?? this.cursor;
    return { from: Math.min(a, this.cursor), to: Math.max(a, this.cursor) };
  }

  clickLine(index, e, cx) {
    if (this.shownDiff()?.file.rows[index]?.kind === "hunk") return;
    this.area = "code";
    if (e?.modifiers?.shift && this.cursor !== null) { if (this.mark === null) this.mark = this.cursor; }
    else this.mark = null;
    this.cursor = index;
    this.handle.focus();
    if (e?.click_count === 2) this.aimCursor(cx);
    else cx.notify();
  }

  expandable(file) {
    const d = this.details[this.iid];
    return Boolean(file?.rows?.length) && !file.new_file && !file.deleted_file && !file.too_large && !file.collapsed
      && (this.local || Boolean(d?.mr.diff_refs?.head_sha));
  }

  async sourceLines(file) {
    const split = (text) => { const lines = String(text).split("\n"); if (lines.at(-1) === "") lines.pop(); return lines; };
    if (this.local) return split(await fs.readFile(`${this.top}/${file.new_path}`, "utf8"));
    const ref = this.details[this.iid].mr.diff_refs.head_sha, key = `${ref}:${file.new_path}`;
    if (!this.sources.has(key)) {
      const p = gl.raw(this.top, file.new_path, ref).then(split);
      p.catch(() => this.sources.delete(key));
      this.sources.set(key, p);
    }
    return this.sources.get(key);
  }

  expand(file, row, how, cx) {
    if (this.expanding) return;
    this.expanding = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const lines = await this.sourceLines(file);
        file.total = lines.length;
        const at = row ? file.rows.indexOf(row) : file.rows.length;
        const op = at < 0 ? null : expandGap(file.rows, at, how, lines);
        if (op) this.spliceRows(file, op);
      } catch (e) {
        this.say(`Couldn't load ${file.new_path}: ${e?.message ?? e}`, cx, "error");
      } finally {
        this.expanding = false;
        cx.notify();
      }
    });
  }

  spliceRows(file, { index, remove, insert }) {
    file.rows.splice(index, remove, ...insert);
    const delta = insert.length - remove;
    const move = (i) => (i === null || i === undefined || i < index ? i : i >= index + remove ? i + delta : index);
    if (this.shownDiff()?.file === file) { this.cursor = move(this.cursor); this.mark = move(this.mark); }
    const t = this.target;
    if (t?.kind === "line" && t.file === file) {
      const at = (r, i) => { const n = file.rows.indexOf(r); return n >= 0 ? n : move(i); };
      this.target = { ...t, index: at(t.row, t.index), ...(t.from !== undefined ? { from: at(t.fromRow, t.from) } : {}) };
    }
    if (this.jump?.file === file) this.jump = { ...this.jump, index: move(this.jump.index) };
  }

  gapBar(t, file, row, index) {
    const g = gapAt(file.rows, index, file.total ?? null);
    const open = this.expandable(file) && g.count !== 0;
    const id = row ? rowId(row) : "eof";
    const btn = (how, label) => h_flex().id(`ex-${id}-${how}`).flex_none().h(18).px(6).items_center().rounded(4).border_1().border_color(t.border)
      .bg(t.popover).text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => this.expand(file, row, how, cx)).child(label);
    const small = g.count !== null && g.count <= 20;
    const what = g.count === null ? "the rest of the file" : `${g.count} unchanged line${g.count > 1 ? "s" : ""}`;
    return h_flex().px(12).py(3).gap(6).items_center().font_family(MONO).text_size(11.5).text_color(t.dim).bg(t.surface)
      .when(open && small, (el) => el.child(btn("all", `↕ ${g.count}`)))
      .when(open && !small && index > 0, (el) => el.child(btn("down", "↓ 20")))
      .when(open && !small, (el) => el.child(btn("all", g.count === null ? "↕ all" : `↕ ${g.count}`)))
      .when(open && !small && Boolean(row), (el) => el.child(btn("up", "↑ 20")))
      .when(open, (el) => el.child(div().flex_none().child(this.expanding ? "loading…" : what)))
      .child(div().flex_1().min_w(0).truncate().child(row ? (open ? row.title : row.text) : ""));
  }

  aimCursor(cx) {
    const v = this.shownDiff(), p = this.codeRange();
    const row = v && p ? v.file.rows[p.to] : null;
    if (!row) return;
    const from = p.from !== p.to ? v.file.rows[p.from] : null;
    this.aim({ kind: "line", file: v.file, row, index: p.to, ...(from ? { from: p.from, fromRow: from } : {}) }, cx);
    this.mark = null;
  }

  render() {
    const t = theme();
    const root = v_flex().id("glr-root").relative().size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .track_focus(this.handle)
      .on_mouse_down("left", (_e, cx) => {
        if (this.editorMenu) { this.editorMenu = false; cx.notify(); }
        if (!this.composing && !this.searchFocused) this.handle.focus();
      })
      .on_key_down((e, cx) => this.onKey(e, cx));
    const d = this.iid ? this.details[this.iid] : null;
    return root.child(this.header(t, d))
      .when(!this.iid && Boolean(this.user), (el) => el.child(this.listTabs(t)))
      .when(!this.iid && (this.searchOpen || Boolean(this.query)), (el) => el.child(this.searchBar(t, this.listed().length, this.mrs.length + this.authored.length + (this.merged?.length ?? 0))))
      .child(this.iid ? this.mrView(t, d) : this.listView(t))
      .child(this.footer(t))
      .when(Boolean(this.toastText), (el) => el.child(this.toastView(t)));
  }

  localHeader(t, d) {
    const busy = this.loading.size > 0;
    return h_flex().h(42).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(this.remote
        ? div().id("h-iid").text_size(14).font_semibold().cursor_pointer().hover((s) => s.text_color(t.accent))
          .on_mouse_down("left", stop).on_click((_e, cx) => this.copy(`!${this.remote.iid}`, cx)).child(`!${this.remote.iid}`)
        : div().text_size(14).font_semibold().child("Branch"))
      .child(div().flex_1().min_w(0).truncate().child(d ? (this.remote ? d.mr.title : this.top.split("/").pop()) : this.top ?? ""))
      .when(busy, (el) => el.child(div().text_size(11).text_color(t.dim).child("loading…")))
      .when(!d, (el) => el.child(this.button(t, "h-search", "Search  ⌘F", (cx) => this.openSearch(cx)))
        .child(this.button(t, "h-refresh", "↻  ⌘R", (cx) => this.reload(cx))));
  }

  localBar(t) {
    const typed = this.draft.value().trim();
    const n = this.notes.length + (typed ? 1 : 0);
    return h_flex().h(40).flex_none().px(16).gap(8).items_center().border_t(1).border_color(t.border)
      .child(div().text_size(12).font_semibold().child("Your review"))
      .when(this.notes.length > 0, (el) => el.child(this.chip(t, `${this.notes.length} pending`, t.accent)))
      .when(Boolean(typed), (el) => el.child(this.chip(t, "+ the text below", t.accent)))
      .child(div().flex_1())
      .when(this.sending, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Sending…")))
      .when(this.notes.length > 0, (el) => el.child(this.button(t, "lc-discard", "Discard all", (cx) => this.discard(cx), false, !this.sending)))
      .when(Boolean(this.remote), (el) => el.child(this.button(t, "lc-post", n ? `Post ${n} on GitLab` : "Post on GitLab", (cx) => this.postNotes(cx), false, n > 0 && !this.sending)))
      .child(this.button(t, "lc-send", n ? `Send ${n} to ${this.agentName()}  a` : `Send to ${this.agentName()}  a`, (cx) => this.sendLocal(cx), true, n > 0 && !this.sending));
  }

  header(t, d) {
    if (this.local) return this.localHeader(t, d);
    const busy = this.loading.size > 0;
    return h_flex().h(42).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .when(Boolean(this.iid), (el) => el.child(this.button(t, "h-back", "← Back", (cx) => this.back(cx))))
      .when(!this.iid, (el) => el.child(div().text_size(14).font_semibold().child("To review")))
      .when(Boolean(this.iid), (el) => el.child(div().id("h-iid").text_size(14).font_semibold().cursor_pointer().hover((s) => s.text_color(t.accent))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.copy(`!${this.iid}`, cx)).child(`!${this.iid}`)))
      .when(Boolean(d), (el) => el.child(div().flex_1().min_w(0).truncate().child(d.mr.title)))
      .when(!d, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(this.project?.path_with_namespace ?? "")))
      .when(busy, (el) => el.child(div().text_size(11).text_color(t.dim).child("loading…")))
      .when(Boolean(d) && Boolean(this.ignored[this.iid]), (el) => el.child(this.chip(t, "ignored")))
      .when(!d, (el) => el.child(this.button(t, "h-search", "Search  ⌘F", (cx) => this.openSearch(cx)))
        .child(this.button(t, "h-refresh", "↻  ⌘R", (cx) => this.reload(cx))))
      .when(Boolean(props()?.overlay), (el) => el.child(this.button(t, "h-close", "×", () => this.dismiss())));
  }

  editorButton(t, anchor = "top_right") {
    const trigger = this.button(t, "h-editor", this.openingEditor ? "Opening…" : "Editor  e", (cx) => this.toggleEditorMenu(cx), false, !this.openingEditor);
    return Popup.new("h-editor-menu", trigger).anchor(anchor)
      .when(this.editorMenu, (el) => el.content(this.editorList(t)));
  }

  editorList(t) {
    const list = this.editors ?? [];
    const note = (text) => div().px(10).py(6).text_size(12).text_color(t.dim).child(text);
    return v_flex().id("h-editor-list").min_w(220).mt(4).p(4).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .on_mouse_down("left", stop)
      .child(div().px(10).pt(4).pb(6).text_size(11).font_semibold().text_color(t.dim).child("Open the branch in"))
      .when(this.editors === null, (el) => el.child(note("Looking for editors…")))
      .when(this.editors !== null && !list.length, (el) => el.child(note("No editor found")))
      .children(list.map((app, n) => h_flex().id(`h-editor-${n}`).h(28).px(10).gap(8).items_center().rounded(6).cursor_pointer().text_size(12.5)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => this.openEditor(app, cx))
        .child(div().w(14).flex_none().text_color(t.accent).child(app === this.editor ? "✓" : ""))
        .child(app)));
  }

  refs(d) {
    const q = this.q();
    if (!q) return [];
    const out = [];
    this.allFiles(d).forEach((f, n) => f.rows.forEach((row, rowIndex) => {
      if (out.length < MAX_REFS && row.kind !== "hunk" && has(row.text, q)) out.push({ f, fileIndex: n, row, rowIndex });
    }));
    return out;
  }

  openRef(ref, cx) {
    this.tab = "changes";
    this.file = ref.fileIndex;
    this.jump = { file: ref.f, index: ref.rowIndex };
    this.cursor = ref.rowIndex;
    this.refsOpen = false;
    this.handle.focus();
    cx.notify();
  }

  refsView(t, d) {
    const refs = this.refs(d);
    if (!refs.length) return v_flex().flex_1().items_center().justify_center().text_color(t.dim).child("No match in the code");
    const q = this.q();
    return v_flex().id("glr-refs").flex_1().min_h(0).py(4).overflow_y_scrollbar()
      .children(refs.map((r, n) => {
        const at = r.row.text.toLowerCase().indexOf(q);
        const from = Math.max(0, at - 40);
        return h_flex().id(`ref-${n}`).mx(6).px(10).h(28).gap(10).items_center().rounded(6).cursor_pointer().font_family(MONO).text_size(12)
          .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => this.openRef(r, cx))
          .child(div().w(12).flex_none().text_color(r.row.kind === "add" ? t.done : r.row.kind === "del" ? t.blocked : t.dim)
            .child(r.row.kind === "add" ? "+" : r.row.kind === "del" ? "-" : " "))
          .child(div().w(320).flex_none().truncate().text_size(11.5).text_color(t.accent).child(`${r.f.new_path}:${r.row.new ?? r.row.old}`))
          .child(h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap()
            .child(div().flex_none().text_color(t.muted).child(r.row.text.slice(from, at)))
            .child(div().flex_none().bg(HIT_BG).text_color(t.foreground).child(r.row.text.slice(at, at + q.length)))
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.row.text.slice(at + q.length))));
      }));
  }

  searchBar(t, shown, total) {
    const d = this.iid ? this.details[this.iid] : null;
    const refs = d && this.q() ? this.refs(d).length : 0;
    return h_flex().h(40).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(h_flex().id("glr-search").h(28).flex_1().px(10).gap(8).items_center().rounded(7).border_1()
        .border_color(this.searchFocused ? t.accent : t.input).bg(t.background).on_mouse_down("left", stop)
        .child(div().text_size(12).text_color(t.dim).child("/"))
        .child(Input.new(this.search).flex_1().h_full().text_size(12.5)))
      .when(Boolean(this.q()) && !this.refsOpen, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(`${shown} / ${total}`)))
      .when(Boolean(d) && Boolean(this.q()), (el) => el.child(this.button(t, "s-refs",
        this.refsOpen ? "Hide the list" : `${refs >= MAX_REFS ? `${MAX_REFS}+` : refs} in the code ↵`,
        (cx) => { this.refsOpen = !this.refsOpen; cx.notify(); }, this.refsOpen)))
      .child(this.button(t, "s-close", "×", (cx) => { this.search.set_value(""); this.query = ""; this.searchOpen = false; this.refsOpen = false; this.handle.focus(); cx.notify(); }));
  }

  footer(t) {
    const s = this.flash ?? this.status;
    const hint = this.descFocused ? "⌘↵ save the description · Esc leave the editor (Cancel drops the changes)"
      : this.composing && this.local ? "⌘↵ add to your review · Esc leave"
      : this.composing ? `⌘↵ add to your review (pending) · ⌥↵ ask ${this.agentName()} (private) · Esc leave`
      : this.local && !this.searchFocused ? `1–4 / Tab sections · ↑↓ files · → into the code (↑↓ lines, fn↑↓ or ⌥↑↓ 8 lines, ⇧ select, Space page, ← back) · c comment, ⌘↵ add to your review · a send the review to ${this.agentName()} · s split · d edit the description · ⇧D draft/ready · e editor · / search · ⌘R refresh`
      : this.searchFocused ? "Type to filter what's loaded · Enter keep · Esc clear"
      : this.iid ? `/ or ⌘F search (Enter lists the matches in the code) · 1–4 / Tab ⇧Tab sections · ↑↓ files · → into the code (↑↓ lines, fn↑↓ or ⌥↑↓ 8 lines, ⇧ select, Space page, c comment, ← back) · s split/unified · y copy the file's path · d edit the description · ⇧D draft/ready · click a line for the cursor (⇧click to select, double-click to comment) · c write · g Ask ${this.agentName()} · i ignore · o browser · e editor (⇧E pick) · ⌘R refresh · Esc back`
      : this.picked().length > 1 ? `${this.picked().length} selected · i ignore or restore them all · Esc unselect`
      : "1–4 / Tab ⇧Tab lists · / search · ↑↓ move · ⇧↑↓ select several · Enter open · i ignore or restore · ⌘R refresh · Esc close";
    const color = s ? (s.level === "error" ? t.blocked : s.level === "success" ? t.done : t.muted) : t.dim;
    return h_flex().h(26).flex_none().px(12).gap(10).items_center().border_t(1).border_color(t.border).text_size(11)
      .child(div().flex_1().min_w(0).truncate().text_color(color).child(s?.text ?? hint))
      .child(div().flex_none().text_color(t.dim).child(this.local ? this.top ?? "" : this.user ? `@${this.user.username}` : ""));
  }

  button(t, id, label, action, primary = false, enabled = true) {
    return h_flex().id(id).h(26).px(10).flex_none().items_center().rounded(6).border_1().text_size(12)
      .border_color(primary ? t.solid : t.border).bg(primary ? t.solid : t.popover).text_color(primary ? t.solid_foreground : t.foreground)
      .when(!enabled, (el) => el.opacity(0.5))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(primary ? t.solid : t.hover)).on_click((_e, cx) => action(cx)))
      .on_mouse_down("left", stop)
      .child(label);
  }

  linkChip(t, id, text, color, url) {
    return h_flex().id(`lc-${id}`).flex_none().h(20).px(8).items_center().rounded(10).border_1().border_color(color ?? t.border)
      .text_size(11).text_color(color ?? t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", stop).on_click((_e, cx) => this.openLink(url, cx))
      .child(text);
  }

  chip(t, text, color) {
    return div().flex_none().h(20).px(8).rounded(10).border_1().border_color(color ?? t.border).text_size(11).text_color(color ?? t.muted).child(text);
  }

  listView(t) {
    const rows = this.listed();
    if (!this.user || (!this.mrs.length && this.loading.has("mrs"))) {
      return v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(this.status?.level === "error" ? "" : "Loading…");
    }
    const section = (id, text, n) => h_flex().id(id).px(16).pt(10).pb(4).gap(8).items_center().text_size(11).font_semibold().text_color(t.dim)
      .child(text).child(div().font_normal().child(String(n)));
    const q = this.q();
    const items = [];
    const replied = this.listTab === "review" ? rows.filter((x) => x.replied).length : 0;
    if (replied) items.push(section("sec-replied", "REPLIED TO YOU", replied));
    rows.forEach((x, n) => {
      if (replied && n === replied) items.push(section("sec-others", "THE OTHERS", rows.length - replied));
      items.push(this.mrRow(t, x, n));
    });
    const empty = q ? "No match"
      : this.listTab === "mine" ? "You have no open merge request here"
      : this.listTab === "ignored" ? "Nothing ignored: i on a merge request puts it here"
      : this.listTab === "merged" ? (this.merged === null || this.loading.has("merged") ? "Loading…" : "No merged merge request you reviewed")
      : this.mrs.length ? "Nothing left: everything else is ignored" : "No open merge request waits on your review here";
    if (!rows.length) items.push(div().px(16).py(10).text_size(12).text_color(t.dim).child(empty));
    return v_flex().id("glr-list").flex_1().min_h(0).pt(4).pb(80).overflow_y_scrollbar().children(items);
  }

  mrRow(t, { m, ignored, merged, replied, own }, n) {
    const on = this.inPick(n);
    const raw = merged ? { kind: "seen", at: null } : this.news(m);
    const nw = own && raw.kind === "new" ? { kind: "seen", at: null } : own && raw.kind === "updated" ? { ...raw, commits: false } : raw;
    const health = own ? this.health[m.iid] : null;
    const pipeColor = { success: t.done, failed: t.blocked, canceled: t.dim, running: t.accent, pending: t.accent };
    const unread = nw.kind !== "seen";
    const me = this.mine[m.iid];
    const mineTag = me?.approved || (!me && this.seen[m.iid]?.approved) ? ["approved", t.done]
      : me?.state === "REQUESTED_CHANGES" ? ["changes requested", t.blocked]
      : me?.commented ? ["commented", t.muted] : null;
    const answers = this.replied[m.iid] ?? [];
    const tags = nw.kind === "new" ? ["new"]
      : nw.kind === "updated" ? [
        answers.length && `↩ ${[...new Set(answers)].join(", ")} replied to you`,
        nw.commits && "new commits",
        nw.notes > answers.length && `+${nw.notes - answers.length} comment${nw.notes - answers.length > 1 ? "s" : ""}`,
        nw.other && "updated",
      ].filter(Boolean) : [];
    return h_flex().id(`mr-${m.iid}`).mx(6).px(10).h(34).gap(10).items_center().rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
      .on_mouse_down("left", stop)
      .on_click((e, cx) => { if (n === this.sel || e.click_count === 2) this.open(m.iid, cx); else { this.anchor = null; this.sel = n; cx.notify(); } })
      .child(h_flex().flex_1().min_w(0).h_full().gap(10).items_center().when(ignored, (el) => el.opacity(0.55))
        .child(div().size(8).flex_none().rounded(4).when(unread, (el) => el.bg(t.accent)))
        .child(h_flex().w(64).flex_none().child(div().id(`mr-iid-${m.iid}`).text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.accent))
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.copy(`!${m.iid}`, cx); }).child(`!${m.iid}`)))
        .when(m.draft, (el) => el.child(this.chip(t, "draft")))
        .when(!(m.target_branch && m.target_branch !== this.baseBranch()) && this.stackedOn(m) > 0, (el) => el.child(this.chip(t, `stack base · ${this.stackedOn(m)} on it`, t.accent)))
        .when(Boolean(m.target_branch) && m.target_branch !== this.baseBranch(), (el) => el.child(this.chip(t, this.stackParents[m.target_branch] ? `stacked on !${this.stackParents[m.target_branch].iid}` : `stacked on ${m.target_branch}`, t.accent)))
        .when(ignored, (el) => el.child(this.chip(t, "ignored")))
        .when(Boolean(mineTag), (el) => el.child(this.chip(t, mineTag?.[0], mineTag?.[1])))
        .child(div().flex_1().min_w(0).truncate().when(unread, (el) => el.font_semibold())
          .text_color(ignored || !unread ? t.muted : t.foreground).child(m.title))
        .children(tags.map((x) => this.chip(t, x, t.accent)))
        .when(Boolean(health?.pipeline), (el) => el.child(this.chip(t, `pipeline ${health.pipeline}`, pipeColor[health.pipeline] ?? t.muted)))
        .when(Boolean(health), (el) => el.child(this.chip(t, health.approved ? `approved${health.by.length ? ` by ${health.by.map((u) => `@${u}`).join(", ")}` : ""}` : `${health.left} approval${health.left === 1 ? "" : "s"} left`, health.approved ? t.done : t.muted)))
        .when(Boolean(health?.conflicts || m.has_conflicts), (el) => el.child(this.chip(t, "conflicts", t.blocked)))
        .when(nw.kind === "seen" && !merged && Boolean(nw.at), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`seen ${agoText(nw.at)}`)))
        .when(Boolean(merged), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`merged ${agoText(m.merged_at)}`)))
        .child(div().w(150).flex_none().truncate().text_size(11.5).text_color(t.muted).child(own ? "you" : who(m.author)))
        .child(div().w(40).flex_none().text_size(11).text_color(t.dim).child(ago(m.updated_at))))
      .when(!merged && !own, (el) => el.child(h_flex().id(`mr-ig-${m.iid}`).h(22).px(8).flex_none().items_center().rounded(5).border_1().border_color(t.border)
        .text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); if (on && this.picked().length > 1) this.ignorePicked(cx); else { this.anchor = null; this.toggleIgnore(m.iid, cx); } })
        .child(ignored ? "Restore" : "Ignore")));
  }

  mrView(t, d) {
    if (!d) return v_flex().flex_1().items_center().justify_center().text_color(t.dim).child("Loading…");
    const q = this.q();
    const files = this.shownFiles(d), threads = this.shownThreads(d);
    const counts = {
      description: q ? String(this.descBlocks(d).length) : "",
      changes: q ? `${files.length}/${d.files.length}` : `${d.files.length}${this.sinceCount(d) ? ` · ${this.sinceCount(d)} changed` : ""}`,
      comments: q ? `${threads.length}/${d.threads.length}` : `${d.threads.length}${this.freshCount(d) ? ` · ${this.freshCount(d)} new` : ""}`,
      review: String(this.local ? this.notes.length + d.drafts.length : d.drafts.length),
    };
    const label = { description: "Description", changes: "Changes", comments: "Comments", review: "Review" };
    const tabs = h_flex().h(36).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .children(TABS.map((tab, n) => {
        const on = this.tab === tab;
        return h_flex().id(`tab-${tab}`).h(24).px(10).gap(6).items_center().rounded(12).border_1().text_size(12).cursor_pointer()
          .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted)
          .on_mouse_down("left", stop).on_click((_e, cx) => this.setTab(tab, cx))
          .child(`${n + 1}  ${label[tab]}`).child(div().text_size(10.5).text_color(t.dim).child(counts[tab]));
      }));
    const body = this.refsOpen && q ? this.refsView(t, d) : this.tab === "changes" ? this.changesView(t, d) : this.tab === "comments" ? this.commentsView(t, d)
      : this.tab === "review" ? this.reviewView(t, d) : this.descriptionView(t, d);
    const total = this.tab === "changes" ? d.files.length : this.tab === "comments" ? d.threads.length : this.tab === "review" ? d.drafts.length
      : d.mr.description ? d.mr.description.split(/\n\s*\n/).length : 0;
    const shown = this.tab === "changes" ? files.length : this.tab === "comments" ? threads.length : this.tab === "review" ? this.shownDrafts(d).length
      : this.descBlocks(d).length;
    const main = v_flex().flex_1().min_w(0).min_h(0)
      .when(this.local, (el) => el.child(this.branchBanner(t, d)))
      .when(this.searchOpen || Boolean(this.query), (el) => el.child(this.searchBar(t, shown, total)))
      .child(body)
      .when(this.local, (el) => el.child(this.localBar(t)))
      .when(!this.local && d.mr.state === "opened", (el) => el.child(this.reviewBar(t, d)))
      .child(this.composer(t, this.local || d.mr.state === "opened"));
    return v_flex().flex_1().min_h(0).child(tabs)
      .child(h_flex().flex_1().min_h(0).items_stretch().child(main).child(this.sidebarView(t, d)));
  }

  avatar(t, name, size = 20) {
    return div().size(size).flex_none().rounded(size / 2).bg(avatarColor(name)).flex().items_center().justify_center()
      .text_size(size * 0.42).font_semibold().text_color("#ffffff").child(initials(name));
  }

  person(t, u, right = null) {
    const me = u.username === this.user?.username;
    return h_flex().id(`sp-${u.username}`).w_full().h(26).gap(8).items_center().rounded(6).px(4).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", stop).on_click((_e, cx) => cx.open_url(`https://gitlab.com/${u.username}`))
      .child(this.avatar(t, u.name ?? u.username))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(me ? t.accent : t.foreground).when(me, (el) => el.font_semibold())
        .child(me ? `${u.name ?? u.username} (you)` : u.name ?? u.username))
      .when(Boolean(right), (el) => el.child(right));
  }

  labelPill(t, l) {
    const [scope, value] = l.title.includes("::") ? [l.title.slice(0, l.title.lastIndexOf("::")), l.title.slice(l.title.lastIndexOf("::") + 2)] : [l.title, null];
    const pill = h_flex().flex_none().h(20).items_center().rounded(10).border_1().border_color(l.color ?? t.border).text_size(11)
      .child(div().h_full().px(8).flex().items_center().bg(l.color ?? t.surface).text_color(l.textColor ?? t.foreground)
        .when(value === null, (el) => el.rounded(10)).when(value !== null, (el) => el.rounded_l(10)).child(scope));
    return value === null ? pill : pill.child(div().px(7).text_color(t.foreground).child(value));
  }

  sideSection(t, title, count, content, action = null) {
    return v_flex().w_full().gap(6)
      .child(h_flex().gap(6).items_center().text_size(11).font_semibold().text_color(t.dim)
        .child(title.toUpperCase()).when(count !== null && count !== undefined, (el) => el.child(div().font_normal().child(String(count))))
        .when(Boolean(action), (el) => el.child(div().flex_1()).child(action)))
      .child(content);
  }

  pipelineChip(t, mr) {
    const st = mr.head_pipeline.status;
    return this.linkChip(t, "pipeline", `pipeline ${st} ↗`, st === "success" ? t.done : st === "failed" ? t.blocked : null,
      mr.head_pipeline.web_url ?? `${mr.web_url}/pipelines`);
  }

  sideLink(t, id, label, action, on = false) {
    return div().id(id).flex_none().px(6).py(1).rounded(5).text_size(11).font_normal().cursor_pointer()
      .text_color(on ? t.accent : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => action(cx)).child(label);
  }

  stackSection(t, d) {
    const { base, below, above } = d.stack;
    const row = (m, depth, current) => h_flex().id(`stk-${m.iid}`).w_full().gap(6).items_center().text_size(12).pl(depth * 10).py(2).rounded(5)
      .when(current, (el) => el.bg(t.selected))
      .when(!current, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => this.openStackBranch(m, cx)))
      .when(m.iid !== "local", (el) => el.child(div().flex_none().text_color(t.dim).child(`!${m.iid}`)))
      .child(div().flex_1().min_w(0).truncate().text_color(current ? t.foreground : t.accent).child(m.title))
      .when(Boolean(m.draft), (el) => el.child(this.chip(t, "draft")));
    const chain = [...below.map((m) => row(m, 0, false)), row(d.mr, 0, true), ...above.map((m) => row(m, Math.min(m.depth - 1, 4), false))];
    return this.sideSection(t, "Stack", below.length + above.length + 1, v_flex().w_full().gap(1)
      .child(div().text_size(11).text_color(t.dim).child(`on ${base}`))
      .children(chain));
  }

  sideRules(t, d) {
    const matches = this.rulesFor(d);
    const note = !this.rules ? (this.rulesError ? `Unavailable: ${this.rulesError}` : "Loading…") : matches.length ? null : "None applies to these files";
    return this.sideSection(t, "Review rules", matches.length || null, v_flex().w_full().gap(4)
      .when(Boolean(note), (el) => el.child(div().text_size(12).text_color(t.dim).child(note)))
      .children(matches.map(({ rule, files }) => h_flex().id(`sr-${rule.page_id}`).w_full().gap(6).items_center().text_size(12)
        .child(div().flex_1().min_w(0).truncate().text_color(rule.page_url ? t.accent : t.foreground)
          .when(Boolean(rule.page_url), (el) => el.cursor_pointer().on_mouse_down("left", stop).on_click((_e, cx) => this.openLink(rule.page_url, cx)))
          .child(rule.page_title))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${files.length} file${files.length > 1 ? "s" : ""}`))))
      .when(matches.length > 0, (el) => el.child(h_flex().pt(4).child(this.button(t, "sr-run", `Review against ${matches.length} rule${matches.length > 1 ? "s" : ""}`, (cx) => this.reviewRules(cx), true)))));
  }

  sidebarView(t, d) {
    const s = d.side, mr = d.mr, real = mr.state !== "local";
    const none = (text) => div().text_size(12).text_color(t.dim).child(text);
    const detail = (k, v) => h_flex().w_full().gap(8).text_size(12).child(div().w(64).flex_none().text_color(t.dim).child(k)).child(div().flex_1().min_w(0).truncate().child(v));
    const copyDetail = (k, v) => h_flex().id(`sd-${k}`).w_full().gap(8).text_size(12).cursor_pointer().hover((s) => s.text_color(t.accent))
      .on_mouse_down("left", stop).on_click((_e, cx) => this.copy(v, cx))
      .child(div().w(64).flex_none().text_color(t.dim).child(k)).child(div().flex_1().min_w(0).truncate().child(v)).child(div().flex_none().text_size(11).text_color(t.dim).child("⧉"));
    const status = real
      ? v_flex().w_full().gap(8)
        .child(h_flex().gap(6).items_center().flex_wrap().child(this.statePill(t, mr))
          .when(mr.state === "opened" && (mr.has_conflicts || mr.detailed_merge_status === "conflict"), (el) => el.child(this.chip(t, "merge conflict", t.blocked)))
          .when(Boolean(mr.detailed_merge_status) && mr.state === "opened" && mr.detailed_merge_status !== "conflict", (el) => el.child(this.chip(t, mr.detailed_merge_status.replace(/_/g, " "))))
          .when(Boolean(mr.head_pipeline?.status), (el) => el.child(this.pipelineChip(t, mr))))
        .when(!this.local && !this.lastVisit[mr.iid] && mr.state === "opened", (el) => el.child(h_flex().child(this.chip(t, "first visit", t.accent))))
        .when(!this.local && Boolean(this.lastVisit[mr.iid]), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`You last looked ${agoText(this.lastVisit[mr.iid].at)}`)))
        .when(Boolean(this.draftable()), (el) => el.child(h_flex().child(this.draftButton(t))))
      : none(d.status?.pushed ? "No merge request for this branch yet" : "Not pushed yet, no merge request");
    const actions = h_flex().w_full().gap(6).flex_wrap()
      .child(this.button(t, "sa-claude", `Ask ${this.agentName()}  g`, (cx) => this.openClaude(cx), true))
      .when(Boolean(mr.web_url), (el) => el.child(this.button(t, "sa-web", "Browser  o", (cx) => cx.open_url(mr.web_url))))
      .child(this.editorButton(t, "top_left"))
      .when(!this.local, (el) => el.child(this.button(t, "sa-ignore", this.ignored[this.iid] ? "Restore  i" : "Ignore  i", (cx) => this.toggleIgnore(this.iid, cx))))
      .child(this.button(t, "sa-search", "Search  ⌘F", (cx) => this.openSearch(cx)))
      .child(this.button(t, "sa-refresh", "↻ Reload  ⌘R", (cx) => this.reload(cx)));
    const side = v_flex().id("mr-side").w(SIDEBAR_W).flex_none().min_h(0).border_l(1).border_color(t.border).bg(t.surface).overflow_y_scrollbar()
      .px(12).py(12).gap(16)
      .child(this.sideSection(t, "Status", null, status))
      .child(this.sideSection(t, "Actions", null, actions))
      .when(real, (el) => el.child(this.sideRules(t, d)));
    if (!real) {
      return side.when(Boolean(d.stack), (el) => el.child(this.stackSection(t, d)))
        .child(this.sideSection(t, "Details", null, v_flex().w_full().gap(4)
          .child(copyDetail("Branch", mr.source_branch ?? ""))
          .child(copyDetail("Into", d.base ?? mr.target_branch ?? ""))));
    }
    const details = this.sideSection(t, "Details", null, v_flex().w_full().gap(4)
      .child(detail("Author", mr.author?.name ?? who(mr.author)))
      .child(copyDetail("Branch", mr.source_branch))
      .child(copyDetail("Into", mr.target_branch))
      .child(detail("Opened", agoText(mr.created_at)))
      .child(detail("Updated", agoText(mr.updated_at))));
    if (!s) return side.child(none("Loading reviewers…")).child(details);
    const people = (list, right) => list.length ? v_flex().w_full().gap(1).children(list.map((u) => this.person(t, u, right?.(u)))) : none("None");
    const reviewState = (r) => {
      const [text, color] = REVIEW_STATE[r.state] ?? REVIEW_STATE.UNREVIEWED;
      return div().flex_none().text_size(11).text_color(t[color] ?? t.dim).child(r.state === "APPROVED" ? `✓ ${text}` : r.state === "REQUESTED_CHANGES" ? `± ${text}` : text);
    };
    const required = s.approvalsRequired ?? 0, left = s.approvalsLeft ?? 0;
    const approvedBy = s.reviewers.filter((r) => r.approved).length;
    const approvals = required > 0
      ? (left === 0 ? `Approved · ${approvedBy} approval${approvedBy === 1 ? "" : "s"}` : `${required - left} of ${required} approvals · ${left} more needed`)
      : approvedBy ? `${approvedBy} approval${approvedBy === 1 ? "" : "s"}, none required` : "No approval required";
    const editable = mr.state === "opened" && Boolean(this.project);
    const peopleSection = (kind, title, right) => {
      const open = this.peoplePick?.kind === kind;
      const me = this.user?.username;
      const mine = s[kind].some((u) => u.username === me);
      return this.sideSection(t, title, s[kind].length || null,
        v_flex().w_full().gap(6).when(open, (el) => el.child(this.peoplePicker(t))).child(people(s[kind], right))
          .when(editable && !open && !mine && Boolean(me), (el) => el.child(h_flex().child(this.sideLink(t, `sp-me-${kind}`, kind === "reviewers" ? "Add yourself" : "Assign yourself",
            (cx) => this.togglePerson(kind, { username: me, name: this.user.name ?? me, on: false }, cx))))),
        editable ? this.sideLink(t, `sp-edit-${kind}`, open ? "Done" : "Edit", (cx) => this.openPeople(kind, cx), open) : null);
    };
    return side
      .when(Boolean(d.stack), (el) => el.child(this.stackSection(t, d)))
      .child(peopleSection("assignees", "Assignees"))
      .child(peopleSection("reviewers", "Reviewers", reviewState))
      .child(this.sideSection(t, "Approvals", null, div().text_size(12).text_color(left === 0 && (required > 0 || approvedBy) ? t.done : t.muted).child(approvals)))
      .child(this.sideSection(t, "Labels", s.labels.length || null,
        s.labels.length ? h_flex().w_full().gap(5).flex_wrap().children(s.labels.map((l) => this.labelPill(t, l))) : none("None")))
      .when(Boolean(s.milestone), (el) => el.child(this.sideSection(t, "Milestone", null, div().text_size(12).child(s.milestone.title))))
      .child(this.sideSection(t, "Participants", s.participants.length || null,
        s.participants.length ? h_flex().w_full().gap(4).flex_wrap().children(s.participants.map((u) =>
          div().id(`spa-${u.username}`).cursor_pointer().on_mouse_down("left", stop).on_click((_e, cx) => cx.open_url(`https://gitlab.com/${u.username}`))
            .child(this.avatar(t, u.name ?? u.username, 24)))) : none("None")))
      .when(s.participants.length > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(s.participants.map((u) => u.name ?? u.username).join(", "))))
      .child(details);
  }

  freshCount(d) {
    return d.threads.reduce((n, x) => n + humanNotes(x).filter((y) => this.isFresh(y)).length, 0);
  }

  sinceCount(d) {
    return d.since ? d.files.filter((f) => d.since.has(f.new_path)).length : 0;
  }

  shownDrafts(d) {
    const q = this.q();
    return q ? d.drafts.filter((x) => has(x.note, q) || has(x.position?.new_path, q)) : d.drafts;
  }

  draftWhere(d, x) {
    const p = x.position;
    if (p && (p.new_line || p.old_line)) return `${p.new_path ?? p.old_path}:${p.new_line ?? p.old_line}`;
    if (x.discussion_id) {
      const th = d.threads.find((y) => y.id === x.discussion_id);
      return th ? `Reply to ${who(humanNotes(th)[0]?.author)}` : "Reply in a thread";
    }
    return this.local ? "General comment" : "Comment on the merge request";
  }

  draftView(t, d, x, forClaude = false) {
    return v_flex().id(`dr-${x.id}`).gap(8).p(12).rounded(8).border_1().border_color(t.accent).bg(t.surface)
      .child(h_flex().gap(8).items_center().text_size(11)
        .child(this.chip(t, forClaude ? "in your review" : "pending on GitLab", t.accent))
        .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_color(t.muted).child(this.draftWhere(d, x)))
        .child(this.button(t, `dr-del-${x.id}`, "Cancel", (cx) => (forClaude ? this.removeNote(x.id, cx) : cx.spawn(async (cx) => this.removeDraft(x.id, cx))))))
      .child(TextView.markdown(`dr-body-${x.id}`, x.note ?? "").selectable());
  }

  rulesView(t, d) {
    const matches = this.rulesFor(d);
    const head = h_flex().gap(8).items_center()
      .child(div().text_size(12).font_semibold().child("Team review rules"))
      .child(div().text_size(11.5).text_color(t.dim).child(!this.rules ? (this.rulesError ? `unavailable: ${this.rulesError}` : "loading…")
        : matches.length ? `${matches.length} apply to this merge request` : "none applies to these files"))
      .child(div().flex_1())
      .when(matches.length > 0, (el) => el.child(this.button(t, "rv-rules", `Ask ${this.agentName()} to review against them`, (cx) => this.reviewRules(cx), true)));
    return v_flex().gap(8).p(12).rounded(8).border_1().border_color(t.border)
      .child(head)
      .children(matches.map(({ rule, globs, files }) => h_flex().id(`rule-${rule.page_id}`).gap(8).items_center().text_size(12)
        .child(this.chip(t, rule.mode))
        .child(div().flex_none().text_color(rule.page_url ? t.accent : t.foreground).cursor_pointer()
          .when(Boolean(rule.page_url), (el) => el.on_mouse_down("left", stop).on_click((_e, cx) => this.openLink(rule.page_url, cx)))
          .child(rule.page_title))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).font_family(MONO)
          .child(`${globs.join(", ")} · ${files.length} file${files.length > 1 ? "s" : ""}`))));
  }

  reviewView(t, d) {
    const list = this.shownDrafts(d);
    const view = v_flex().id("glr-review").flex_1().min_h(0).p(16).pb(120).gap(12).overflow_y_scrollbar().child(this.rulesView(t, d));
    if (this.local) {
      const q = this.q();
      const notes = q ? this.notes.filter((x) => has(x.note, q) || has(x.position?.new_path, q)) : this.notes;
      return view
        .child(div().text_size(12).font_semibold().child(`Your review · ${notes.length}`))
        .when(!notes.length, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`c on a line (or a reply, or text here), then ⌘↵, adds to your review; at the end send it to ${this.agentName()} (a)${this.remote ? " or Post on GitLab" : ""}`)))
        .children(notes.map((x) => this.draftView(t, d, x, true)))
        .when(list.length > 0, (el) => el.child(div().pt(8).text_size(12).font_semibold().child(`Pending on GitLab · ${list.length}`)))
        .children(list.map((x) => this.draftView(t, d, x)));
    }
    if (!list.length) {
      return view.child(v_flex().items_center().gap(6).pt(24).text_color(t.dim)
        .child(this.q() ? "No match" : "No pending comment")
        .child(div().text_size(11.5).child("Write a comment and press ⌘↵: it waits here until you submit your review")));
    }
    return view.children(list.map((x) => this.draftView(t, d, x)));
  }

  reviewBar(t, d) {
    const typed = this.draft.value().trim();
    const n = d.drafts.length + (typed ? 1 : 0), mine = d.approvals?.user_has_approved;
    const busy = this.reviewing;
    const go = (then) => (cx) => {
      const text = this.draft.value().trim();
      const pending = text ? this.draftPayload(text) : null;
      cx.spawn(async (cx) => this.submit(then, cx, pending));
    };
    return h_flex().h(40).flex_none().px(16).gap(8).items_center().border_t(1).border_color(t.border)
      .child(div().text_size(12).font_semibold().child("Your review"))
      .when(d.drafts.length > 0, (el) => el.child(this.chip(t, `${d.drafts.length} pending`, t.accent)))
      .when(Boolean(typed), (el) => el.child(this.chip(t, "+ the text below", t.accent)))
      .when(Boolean(mine), (el) => el.child(this.chip(t, "approved by you", t.done)))
      .when(d.state === "REQUESTED_CHANGES", (el) => el.child(this.chip(t, "you requested changes", t.blocked)))
      .when(!mine && Boolean(d.approvals?.approvals_left), (el) => el.child(this.chip(t, `${d.approvals.approvals_left} approval${d.approvals.approvals_left > 1 ? "s" : ""} left`)))
      .child(div().flex_1())
      .when(d.drafts.length > 0, (el) => el.child(this.button(t, "rv-discard", "Discard all", (cx) => this.discard(cx), false, !busy)))
      .when(d.drafts.length > 0, (el) => el.child(this.button(t, "rv-claude", `Ask ${this.agentName()} about these ${d.drafts.length}`, (cx) => this.askAboutReview(cx), false, !busy)))
      .when(busy, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Submitting…")))
      .child(this.button(t, "rv-changes", n ? `Submit ${n} + request changes` : "Request changes", go("changes"), false, !busy))
      .child(mine
        ? this.button(t, "rv-unapprove", n ? `Submit ${n} + revoke approval` : "Revoke approval", go("unapprove"), false, !busy)
        : this.button(t, "rv-approve", n ? `Submit ${n} + approve` : "Approve", go("approve"), false, !busy && d.approvals?.user_can_approve !== false))
      .when(n > 0, (el) => el.child(this.button(t, "rv-submit", `Submit ${n} comment${n > 1 ? "s" : ""}`, go(null), true, !busy)));
  }

  descBlocks(d) {
    const blocks = (d.mr.description ?? "").split(/\n\s*\n/).filter((b) => b.trim());
    const q = this.q();
    return q ? blocks.filter((b) => has(b, q)) : blocks;
  }

  descriptionView(t, d) {
    if (d.mr.state === "local") {
      const st = d.status;
      return v_flex().id("glr-desc").flex_1().min_h(0).p(16).pb(120).gap(10).overflow_y_scrollbar()
        .child(div().text_size(14).font_semibold().child(st?.pushed ? "No merge request for this branch yet" : "Not pushed yet, no merge request"))
        .child(div().text_size(12.5).text_color(t.muted).child(`${d.mr.source_branch} against ${d.base ?? "master"}: ${d.files.length} file${d.files.length === 1 ? "" : "s"} changed${st?.ahead ? `, ${st.ahead} commit${st.ahead > 1 ? "s" : ""}` : ""}${st?.dirty ? `, ${st.dirty} not committed` : ""}.`))
        .child(div().text_size(12).text_color(t.dim).child(`Comments on the code go to ${this.agentName()} here (c, then a). Once the branch has a merge request, its description, threads and review show up in this same view.`));
    }
    if (this.descEdit?.iid === d.mr.iid) return this.descriptionEditor(t, d);
    const q = this.q();
    const text = q ? this.descBlocks(d).join("\n\n---\n\n") || "_No match in the description_" : d.mr.description?.trim() || "_No description_";
    return v_flex().id("glr-desc").flex_1().min_h(0).p(16).pb(120).gap(14).overflow_y_scrollbar()
      .when(!q, (el) => el.child(this.newsPanel(t, d)))
      .when(!q, (el) => el.child(h_flex().justify_end().child(this.button(t, "desc-edit", "Edit description  d", (cx) => this.editDescription(cx)))))
      .children(this.markdownView(t, `desc-${d.mr.iid}-${q}`, text, d));
  }

  newsPanel(t, d) {
    const visit = this.lastVisit[d.mr.iid];
    if (!visit) return div();
    const me = this.user?.username;
    const since = visit.at;
    const replies = repliesTo(d.threads, me, since);
    const replyIds = new Set(replies.map((r) => r.note.id));
    const others = d.threads.flatMap((x) => humanNotes(x).filter((n) => this.isFresh(n) && !replyIds.has(n.id)).map((note) => ({ thread: x, note })));
    const events = d.events.filter((n) => String(n.created_at) > since && n.author?.username !== me && !/^added \d+ commit/.test(n.body ?? ""));
    const commits = d.newCommits ?? [];
    const changed = this.sinceCount(d);
    const empty = !replies.length && !others.length && !events.length && !commits.length;
    const where = (x) => {
      const p = humanNotes(x)[0]?.position;
      return p ? `${p.new_path ?? p.old_path}:${p.new_line ?? p.old_line}` : "the merge request";
    };
    const line = (id, icon, color, head, text, action) => h_flex().id(id).gap(8).items_start().px(8).py(5).rounded(6).text_size(12)
      .when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => action(cx)))
      .child(div().w(16).flex_none().text_color(color).child(icon))
      .child(div().flex_none().font_semibold().child(head))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(text));
    const group = (title, n, rows) => n ? v_flex().gap(2)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(`${title} · ${n}`)).children(rows) : null;
    const toComments = (cx) => this.setTab("comments", cx);
    return v_flex().gap(10).p(12).rounded(8).border_1().border_color(empty ? t.border : t.accent).bg(t.surface)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(12.5).font_semibold().child("Since your last visit"))
        .child(div().text_size(11.5).text_color(t.dim).child(agoText(visit.at))))
      .when(empty, (el) => el.child(div().text_size(12).text_color(t.dim).child("Nothing new")))
      .children([
        group("Replies to you", replies.length, replies.map((r, n) => line(`nw-r-${n}`, "↩", t.blocked, who(r.note.author),
          `on ${where(r.thread)}: ${firstLine(r.note.body)}`, toComments))),
        group("New comments", others.length, others.map((r, n) => line(`nw-c-${n}`, "💬", t.accent, who(r.note.author),
          `on ${where(r.thread)}: ${firstLine(r.note.body)}`, toComments))),
        group("New commits", commits.length, [
          ...commits.slice(0, 10).map((c, n) => line(`nw-k-${n}`, "⎇", t.done, c.short_id, firstLine(c.title), null)),
          ...(changed ? [line("nw-files", "●", t.accent, `${changed} file${changed > 1 ? "s" : ""} changed`, "see Changes, marked ● new", (cx) => this.setTab("changes", cx))] : []),
        ]),
        group("Activity", events.length, events.slice(0, 10).map((n, i) => line(`nw-e-${i}`, "•", t.dim, who(n.author), firstLine(n.body), null))),
      ].filter(Boolean));
  }

  noteView(t, n, key) {
    return v_flex().gap(4)
      .child(h_flex().gap(8).items_center().text_size(11.5)
        .child(div().font_semibold().child(who(n.author)))
        .child(div().text_color(t.dim).child(ago(n.created_at)))
        .when(this.isFresh(n), (el) => el.child(this.chip(t, "new since your last visit", t.accent))))
      .children(this.markdownView(t, key, n.body ?? "", this.details[this.iid]));
  }

  threadView(t, d, x) {
    const notes = humanNotes(x);
    const first = notes[0];
    const pos = first.position;
    const resolved = first.resolvable && x.notes.every((n) => !n.resolvable || n.resolved);
    const fresh = notes.some((n) => this.isFresh(n));
    return v_flex().id(`th-${x.id}`).gap(10).p(12).rounded(8).border_1().border_color(fresh ? t.accent : t.border).bg(t.surface)
      .when(resolved, (el) => el.opacity(0.6))
      .when(Boolean(pos), (el) => el.child(h_flex().id(`th-pos-${x.id}`).gap(8).items_center().text_size(11).text_color(t.accent).cursor_pointer()
        .on_mouse_down("left", stop).on_click((_e, cx) => this.showPosition(d, pos, cx))
        .child(div().font_family(MONO).child(`${pos?.new_path ?? pos?.old_path}:${pos?.new_line ?? pos?.old_line}`))))
      .children(notes.map((n) => this.noteView(t, n, `n-${n.id}`)))
      .child(h_flex().gap(6).items_center()
        .when(resolved, (el) => el.child(this.chip(t, "resolved", t.done)))
        .child(div().flex_1())
        .when(this.local, (el) => el.child(this.button(t, `th-claude-${x.id}`, `→ ${this.agentName()}`, (cx) => this.sendThreads([x], cx), false, !this.sending)))
        .child(this.button(t, `th-reply-${x.id}`, "Reply / ask", (cx) => this.aim({ kind: "reply", discussionId: x.id, who: who(first.author) }, cx))));
  }

  showPosition(d, pos, cx) {
    const n = this.allFiles(d).findIndex((f) => f.new_path === pos.new_path || f.old_path === pos.old_path);
    if (n >= 0) { this.file = n; this.tab = "changes"; cx.notify(); }
  }

  commentsView(t, d) {
    const threads = this.shownThreads(d);
    if (!threads.length) return v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(this.q() ? "No match" : "No comments yet");
    const open = this.openThreads(d);
    return v_flex().id("glr-comments").flex_1().min_h(0).p(16).pb(120).gap(12).overflow_y_scrollbar()
      .when(this.local && open.length > 0, (el) => el.child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(12).text_color(t.muted).child(`${open.length} unresolved thread${open.length > 1 ? "s" : ""}`))
        .child(this.button(t, "th-claude-all", `Send the ${open.length} unresolved to ${this.agentName()}`, (cx) => this.sendThreads(open, cx), true, !this.sending))))
      .children(threads.map((x) => this.threadView(t, d, x)));
  }

  changesView(t, d) {
    if (!d.files.length) return v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(this.loading.has(`diffs:${d.mr.iid}`) ? "Loading…" : "No changes");
    const shown = this.shownFiles(d);
    if (!shown.length) return v_flex().flex_1().items_center().justify_center().text_color(t.dim).child("No match");
    const file = (shown.find((x) => x.index === this.file) ?? shown[0]).f;
    const threadsOf = (f) => d.threads.filter((x) => {
      const p = humanNotes(x)[0]?.position;
      return p && (p.new_path === f.new_path || p.old_path === f.old_path);
    });
    const split = this.newOnly(d);
    const newCount = split ? d.sinceFiles.length : 0;
    const heading = (id, text, count) => h_flex().id(id).px(12).pt(8).pb(3).gap(6).items_center().text_size(10.5).font_semibold().text_color(t.dim)
      .child(text).child(div().font_normal().child(String(count)));
    const toggle = d.sinceFiles?.length ? h_flex().px(8).pb(4).child(this.button(t, "fd-toggle",
      this.fullDiff ? "Only what's new since your visit" : "See everything from the start", (cx) => this.toggleFullDiff(cx))) : null;
    const list = v_flex().id("glr-files").w(FILES_W).flex_none().h_full().min_h(0).pt(4).pb(80).border_r(1).border_color(t.border).overflow_y_scrollbar()
      .when(Boolean(toggle), (el) => el.child(toggle))
      .children(shown.flatMap(({ f, index: n, hits }, at) => {
        const head = !split ? [] : n < newCount && at === 0 ? [heading("fh-new", "NEW SINCE YOUR LAST VISIT", newCount)]
          : n >= newCount && (at === 0 || shown[at - 1].index < newCount) ? [heading("fh-old", "ALREADY REVIEWED", d.files.length - d.files.filter((x) => d.since?.has(x.new_path)).length)] : [];
        return [...head, this.fileRow(t, d, f, n, hits, file, threadsOf)];
      }));
    return h_flex().flex_1().min_h(0).items_start()
      .on_size_change((size, cx) => {
        const box = size.height - 32;
        if (this.ds && Math.abs((this.ds.box ?? 0) - box) > 0.5) { this.ds.box = box; cx.notify(); }
      })
      .child(list).child(this.diffView(t, d, file, threadsOf(file)));
  }

  fileRow(t, d, f, n, hits, file, threadsOf) {
        const on = f === file;
        const dim = on && this.area === "code";
        const parts = f.new_path.split("/");
        const count = threadsOf(f).length;
        const onFile = (p) => p && (p.new_line || p.old_line) && (p.new_path === f.new_path || p.old_path === f.old_path);
        const pending = d.drafts.filter((x) => onFile(x.position)).length + (this.local ? this.notes.filter((x) => onFile(x.position)).length : 0);
        const posted = threadsOf(f).reduce((n, x) => n + humanNotes(x).filter((y) => y.author?.username === this.user?.username).length, 0);
        return h_flex().id(`f-${n}`).mx(4).px(8).h(28).gap(6).items_center().rounded(6).cursor_pointer()
          .when(on, (el) => el.bg(dim ? t.hover : t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
          .on_mouse_down("left", stop).on_click((_e, cx) => { this.file = n; this.jump = null; this.cursor = null; this.area = "files"; this.handle.focus(); cx.notify(); })
          .child(div().w(12).flex_none().text_size(11).font_family(MONO)
            .text_color(f.new_file ? t.done : f.deleted_file ? t.blocked : t.dim).child(fileMark(f)))
          .child(div().flex_none().text_size(12).child(parts.pop()))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(parts.join("/")))
          .when(this.local && Boolean(f.state), (el) => el.children(FILE_STATE.filter(([key]) => f.state[key])
            .map(([, label, color]) => div().flex_none().text_size(10.5).text_color(t[color]).child(label))))
          .when(this.fullDiff && Boolean(d.since?.has(f.new_path)), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.accent).child("changed")))
          .when(hits > 0, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.blocked).child(`${hits} match${hits > 1 ? "es" : ""}`)))
          .when(pending > 0, (el) => el.child(div().flex_none().px(5).rounded(8).bg(t.accent).text_size(10.5).text_color(t.accent_foreground).child(`${pending} pending`)))
          .when(pending === 0 && count > 0, (el) => el.child(div().flex_none().text_size(10.5).text_color(posted > 0 ? t.done : t.dim).child(`${count} thread${count > 1 ? "s" : ""}`)));
  }

  diffView(t, d, file, threads) {
    const mode = (key, label) => h_flex().id(`dm-${key}`).h(22).px(8).items_center().rounded(5).text_size(11.5).cursor_pointer()
      .bg((key === "split") === this.split ? t.selected : t.popover).text_color((key === "split") === this.split ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground)).on_mouse_down("left", stop)
      .on_click((_e, cx) => { if ((key === "split") !== this.split) this.toggleSplit(cx); })
      .child(label);
    const head = h_flex().h(32).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().flex_shrink(1).min_w(0).truncate().font_family(MONO).text_size(12)
          .child(file.renamed_file ? `${file.old_path} → ${file.new_path}` : file.new_path))
        .child(h_flex().id("copy-path").flex_none().h(20).px(6).gap(4).items_center().rounded(5).border_1().border_color(t.border)
          .text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => this.copy(file.new_path, cx))
          .child("⧉ Copy").child(div().text_color(t.dim).child("y"))))
      .when(Boolean(file.interdiff), (el) => el.child(this.chip(t, "only what changed since your last visit", t.accent)))
      .child(h_flex().flex_none().p(2).gap(2).rounded(7).border_1().border_color(t.border).child(mode("unified", "Unified")).child(mode("split", "Split  s")));
    if (file.too_large || file.collapsed || !file.rows.length) {
      return v_flex().flex_1().min_w(0).h_full().child(head)
        .child(v_flex().flex_1().items_center().justify_center().gap(8).text_color(t.dim)
          .child(file.too_large || file.collapsed ? "This diff is too large to show here" : "No textual change")
          .when(Boolean(d.mr.web_url), (el) => el.child(this.button(t, "d-web", "Open in browser", (cx) => cx.open_url(`${d.mr.web_url}/diffs`)))));
    }
    const jump = this.jump?.file === file ? this.jump.index : null;
    const start = jump === null ? 0 : Math.max(0, jump - JUMP_ABOVE);
    const rows = file.rows.slice(start, start + MAX_ROWS);
    const t2 = this.target;
    const q = this.q();
    const S = this.diffScroll(`${d.mr.iid}:${this.file}:${start}:${this.split ? "split" : "unified"}`);
    const key = (i) => `r${rowId(file.rows[i])}`;
    S.keyOf = {};
    const items = [];
    const push = (key, el) => items.push({ key, el });
    if (start > 0) {
      push("above", h_flex().px(12).py(4).gap(8).items_center().text_size(11.5).text_color(t.dim).bg(t.surface)
        .child(`⋯ ${start} lines above`)
        .child(this.button(t, "d-all", "Show the whole file", (cx) => { this.jump = null; cx.notify(); })));
    }
    const sel = this.area === "code" ? this.codeRange() : null;
    const aimed = (index) => t2.kind === "line" && t2.file === file && index <= t2.index && index >= (t2.from ?? t2.index);
    const flags = (index) => ({ on: aimed(index), hit: Boolean(q) && file.rows[index].kind !== "hunk" && has(file.rows[index].text, q),
      jumped: index === jump, cursor: Boolean(sel) && index >= sel.from && index <= sel.to });
    const notes = (row) => {
      for (const x of threads) if (onRow(humanNotes(x)[0]?.position, file, row)) push(`t${x.id}`, div().pl(96).pr(12).py(6).child(this.threadView(t, d, x)));
      for (const x of d.drafts) if (onRow(x.position, file, row)) push(`d${x.id}`, div().pl(96).pr(12).py(6).child(this.draftView(t, d, x)));
      if (this.local) for (const x of this.notes) if (onRow(x.position, file, row)) push(`n${x.id}`, div().pl(96).pr(12).py(6).child(this.draftView(t, d, x, true)));
    };
    if (this.split) {
      for (const pair of splitRows(file.rows, start, start + rows.length)) {
        if (pair.hunk !== undefined) { S.keyOf[pair.hunk] = key(pair.hunk); push(key(pair.hunk), this.rowView(t, file, file.rows[pair.hunk], pair.hunk, false, false)); continue; }
        const pk = `p${rowId(file.rows[pair.left ?? pair.right])}-${rowId(file.rows[pair.right ?? pair.left])}`;
        for (const i of [pair.left, pair.right]) if (i !== null) S.keyOf[i] = pk;
        push(pk, h_flex().w_full().items_stretch()
          .child(this.halfView(t, file, pair.left, "left", pair.left === null ? {} : flags(pair.left)))
          .child(div().w(1).flex_none().bg(t.border))
          .child(this.halfView(t, file, pair.right, "right", pair.right === null ? {} : flags(pair.right))));
        if (pair.left !== null) notes(file.rows[pair.left]);
        if (pair.right !== null && pair.right !== pair.left) notes(file.rows[pair.right]);
      }
    } else {
      rows.forEach((row, at) => {
        const index = start + at, f = flags(index);
        S.keyOf[index] = key(index);
        push(key(index), this.rowView(t, file, row, index, f.on, f.hit, f.jumped, f.cursor));
        notes(row);
      });
    }
    if (file.rows.length <= start + MAX_ROWS && this.expandable(file) && gapAt(file.rows, file.rows.length, file.total ?? null).count !== 0) {
      push("eof", this.gapBar(t, file, null, file.rows.length));
    }
    if (file.rows.length > start + MAX_ROWS) push("more", div().p(12).text_color(t.dim).child(`${file.rows.length - start - MAX_ROWS} more lines: open in the browser`));
    const guess = (key) => (/^[rp]/.test(key) ? CODE_ROW : /^[tdn]/.test(key) ? 90 : 28);
    let y = 4;
    for (const it of items) { S.tops[it.key] = y; y += S.h[it.key] ?? guess(it.key); }
    const tail = Math.max(120, Math.round((S.view || 0) * 0.4));
    S.content = Math.max(y + tail, S.inner ?? 0);
    S.view = Math.min(...[S.frame, S.box].filter((x) => x > 0), Infinity);
    if (!Number.isFinite(S.view)) S.view = 0;
    if (S.follow !== null && this.area === "code") { const f = S.follow; S.follow = null; this.reveal(f); S.follow = null; }
    S.y = Math.max(0, Math.min(Math.max(0, S.content - S.view), S.y));
    const thumbH = S.content > S.view && S.view > 0 ? Math.max(24, (S.view * S.view) / S.content) : 0;
    const thumbTop = thumbH ? (S.y / Math.max(1, S.content - S.view)) * (S.view - thumbH) : 0;
    return v_flex().flex_1().min_w(0).h_full().child(head)
      .child(v_flex().id(`glr-diff-${S.key}`).relative().flex_1().min_h(0).overflow_hidden()
        .on_size_change((size, cx) => { if (Math.abs(size.height - (S.frame ?? 0)) > 0.5) { S.frame = size.height; cx.notify(); } })
        .on_scroll_wheel((e, cx) => this.scrollDiff(-e.delta.y, cx))
        .child(v_flex().id(`glr-diff-in-${S.key}`).flex_none().w_full().mt(-S.y).pt(4).pb(tail)
          .on_size_change((size, cx) => { if (Math.abs(size.height - (S.inner ?? 0)) > 0.5) { S.inner = size.height; cx.notify(); } })
          .children(items.map((it) => div().id(`di-${it.key}`).w_full().flex_none()
            .on_size_change((size, cx) => { if (Math.abs((S.h[it.key] ?? -1) - size.height) > 0.5) { S.h[it.key] = size.height; cx.notify(); } })
            .child(it.el))))
        .when(thumbH > 0, (el) => el.child(div().absolute().top(thumbTop).right(2).w(5).h(thumbH).rounded(3).bg(t.border))));
  }

  halfView(t, file, index, side, f) {
    if (index === null) return div().flex_1().min_w(0).bg(t.surface);
    const row = file.rows[index];
    const bg = row.kind === "add" ? ADD_BG : row.kind === "del" ? DEL_BG : null;
    const n = side === "left" ? row.old : row.new;
    return h_flex().id(`h-${side}-${index}`).flex_1().min_w(0).px(8).gap(4).items_start().font_family(MONO).text_size(12).cursor_pointer()
      .when(Boolean(bg), (el) => el.bg(bg))
      .when(Boolean(f.hit), (el) => el.bg(HIT_BG))
      .when(Boolean(f.jumped), (el) => el.bg(JUMP_BG).border_l(2).border_color(t.blocked))
      .when(Boolean(f.cursor), (el) => el.bg(CURSOR_BG).border_l(3).border_color(t.accent))
      .when(Boolean(f.on), (el) => el.bg(t.selection).border_l(2).border_color(t.accent))
      .hover((s) => s.bg(f.on ? t.selection : t.hover))
      .on_mouse_down("left", stop)
      .on_click((e, cx) => this.clickLine(index, e, cx))
      .child(div().w(40).flex_none().text_size(11).text_color(t.dim).child(n === undefined ? "" : String(n)))
      .child(div().w(12).flex_none().text_color(row.kind === "add" ? t.done : row.kind === "del" ? t.blocked : t.dim)
        .child(row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "))
      .child(div().flex_1().min_w(0).child(row.text || " "));
  }

  rowView(t, file, row, index, on, hit, jumped = false, cursor = false) {
    if (row.kind === "hunk") return this.gapBar(t, file, row, index);
    const bg = row.kind === "add" ? ADD_BG : row.kind === "del" ? DEL_BG : null;
    const num = (n) => div().w(44).flex_none().text_size(11).text_color(t.dim).child(n === undefined ? "" : String(n));
    return h_flex().id(`r-${index}`).px(8).gap(4).items_start().font_family(MONO).text_size(12).cursor_pointer()
      .when(Boolean(bg), (el) => el.bg(bg))
      .when(hit, (el) => el.bg(HIT_BG))
      .when(jumped, (el) => el.bg(JUMP_BG).border_l(2).border_color(t.blocked))
      .when(cursor, (el) => el.bg(CURSOR_BG).border_l(3).border_color(t.accent))
      .when(on, (el) => el.bg(t.selection).border_l(2).border_color(t.accent))
      .hover((s) => s.bg(on ? t.selection : t.hover))
      .on_mouse_down("left", stop)
      .on_click((e, cx) => this.clickLine(index, e, cx))
      .child(num(row.old)).child(num(row.new))
      .child(div().w(12).flex_none().text_color(row.kind === "add" ? t.done : row.kind === "del" ? t.blocked : t.dim)
        .child(row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "))
      .child(div().flex_1().min_w(0).child(row.text || " "));
  }

  composer(t, open = true) {
    const empty = !this.draft.value().trim();
    return v_flex().flex_none().gap(8).px(16).py(10).border_t(1).border_color(t.border).bg(t.popover)
      .child(h_flex().gap(8).items_center().text_size(11.5)
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(this.target === GENERAL ? t.muted : t.accent).child(this.targetLabel()))
        .when(this.target !== GENERAL, (el) => el.child(this.button(t, "c-untarget", "×", (cx) => this.aim(GENERAL, cx)))))
      .child(div().id("c-draft").w_full().min_w(0).rounded(8).border_1().border_color(this.composing ? t.accent : t.border).bg(t.background)
        .on_mouse_down("left", stop).child(Textarea.new(this.draft).w_full()))
      .child(h_flex().gap(8).items_center().justify_end()
        .when(!this.local, (el) => el.child(this.button(t, "c-ask", `Ask ${this.agentName()}  ⌥↵`, (cx) => this.ask(cx), false, !empty)))
        .when(!this.local, (el) => el.child(this.button(t, "c-post", "Post now", (cx) => this.post(cx), false, !empty && !this.sending)))
        .when(this.closable()?.state === "opened", (el) => {
          const withText = !this.local && this.target === GENERAL && !empty;
          return el.child(this.button(t, "c-closemr",
            this.closing ? "Closing…" : withText ? "Comment & close" : this.local ? `Close !${this.closable().iid}` : "Close MR",
            (cx) => this.setMrState("close", cx, withText ? this.draft.value().trim() : null), false, !this.closing && !this.sending));
        })
        .when(this.closable()?.state === "closed", (el) => el.child(this.button(t, "c-reopen", this.local ? `Reopen !${this.closable().iid}` : "Reopen", (cx) => this.setMrState("reopen", cx), false, !this.closing)))
        .when(open, (el) => el.child(this.button(t, "c-add", this.sending ? "Saving…" : "Add to review  ⌘↵", (cx) => this.addToReview(cx), true, !empty && !this.sending))));
  }
}
