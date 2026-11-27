// Linear for the Herdr app: find, read and start work on Linear issues in a window.
// Wide windows preview the selected issue on the right; Enter opens it.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView, ScrollHandle } from "gpui-base";
import { theme, props, closeOverlay, run, focused, panes, spaces, terminals, exec, hc, home, appHome, nextCommand, window as appWindow } from "herdr";
import * as fs from "fs/promises";
import * as api from "./api.js";
import { isoDay, parseDay } from "./dates.js";
import * as Q from "./query.js";
import { Images, splitMarkdown, splitImages, imageParts, imageUrls } from "./media.js";
import { Store, JsonFile } from "./store.js";
import { parentChoices } from "./prompts.js";
import { T, setLanguage } from "./i18n.js";
import { Places, issueBranch } from "./places.js";
import { stateIcon } from "./states.js";
import * as Doc from "./doc.js";
import { historyEntries, createdBy } from "./history.js";
import { projectEvents } from "./activity.js";
import { editPoint, mentionAt, rankPeople, insertMention } from "./mention.js";
import { agentArgv, agentName, askArgv } from "./agent.js";

const BASE = "mods/linear";
const ICON = `${BASE}/icons`;
const NARROW = 640, SIDEBAR_W = 280;
const RECENT_MAX = 30;
const RECENT_PROJECTS = 8;
const MORE_AHEAD = 10;
const BOARD_MAX = 250;
const ROW_H = 30, ROW2_H = 46, LINE_H = 22, META_H = 18, HEAD_H = 28;
const CACHE_MAX = 400;
const URGENT = "#eb5757";
const STAR = "#f2c94c";
const CLAUDE = "#D97757";
const AGENT_COLOR = { codex: "#10A37F", gemini: "#4285F4", opencode: "#A78BFA", cursor: "#38BDF8", aider: "#22C55E", amp: "#F472B6", other: "#60A5FA" };
const SUB_BG = "#3b82f614";
// GitHub's pull request colors.
const PR_COLOR = { open: "#3fb950", draft: null, merged: "#a371f7", closed: "#f85149" };
const PR_ICON = { open: "pr", draft: "pr", merged: "pr-merged", closed: "pr-closed" };
const REVIEW_COLOR = { approved: "#3fb950", changes: "#d29922" };
const PRIO_ICON = { 0: "prio-none", 1: "prio-urgent", 2: "prio-3", 3: "prio-2", 4: "prio-1" };
const VIEW_TAB = "v:";
const NOBODY = "none";
const isViewTab = (tab) => String(tab ?? "").startsWith(VIEW_TAB);
const viewIdOf = (tab) => (isViewTab(tab) ? tab.slice(VIEW_TAB.length) : null);
const IDENT_IN_TEXT = /(?:^|[^a-z0-9])([a-z][a-z0-9]*)-(\d+)(?![0-9])/gi;
const IDENT_IN_NAME = /[A-Za-z][A-Za-z0-9]*-\d+/g;
const WATCH_LABEL = /^linear\.(watch|mr|pipeline)\.([A-Z][A-Z0-9]*-\d+)$/;
const WATCH_RANK = { watch: 1, mr: 2, pipeline: 3 };
const CLAUDE_ICON = "icons/claude.svg";
const TREE_STEP = 22, TREE_X = 7; // a sub-issue level's indent, and where its line runs (under the parent's priority icon)
const CLOSED = new Set(["completed", "canceled", "duplicate"]);
const SORTS = ["default", "updated", "created", "priority", "state"];
const LAYOUTS = ["list", "board"];
const BOARD_COL = 300;
const BOARD_RANK = { triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 4, canceled: 5, duplicate: 6 };
// Board order of state types, for sorting by state: what's being worked on first, closed last.
const STATE_RANK = { started: 0, unstarted: 1, triage: 2, backlog: 3, completed: 4, canceled: 5, duplicate: 6 };


// "42s", "7m 05s", "1h 12m".
function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function ago(iso) {
  if (!iso) return "";
  const a = T().ago;
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return a.now;
  if (m < 60) return a.m(m);
  if (m < 1440) return a.h(Math.floor(m / 60));
  if (m < 43200) return a.d(Math.floor(m / 1440));
  return iso.slice(0, 10);
}

// Every open of the window is a fresh copy of the mod (its localStorage starts empty), so the
// cache is one file that every copy reads first.
const STORE = new Store(`${appHome()}/${BASE}/.cache`, exec);
const VIEWS = new JsonFile(`${appHome()}/${BASE}/.cache`, "views.json", exec);
const CLI = () => `${appHome()}/${BASE}/cli/linear-me.mjs`;
const ASK_DENY = [
  "Edit", "Write", "NotebookEdit",
  "Bash(git commit:*)", "Bash(git push:*)", "Bash(git checkout:*)", "Bash(git switch:*)", "Bash(git reset:*)",
  "Bash(git stash:*)", "Bash(git rebase:*)", "Bash(git merge:*)", "Bash(glab mr note:*)", "Bash(glab api:*)",
  "Bash(node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs call save_*)", "Bash(node ~/.config/herdr-app/mods/linear/cli/linear-me.mjs call delete_*)",
  `Bash(node ${appHome()}/${BASE}/cli/linear-me.mjs call save_*)`, `Bash(node ${appHome()}/${BASE}/cli/linear-me.mjs call delete_*)`,
  "mcp__linear-me__save_comment", "mcp__linear-me__save_issue", "mcp__linear-me__delete_comment",
];
const load = (k, d) => STORE.get(k, d);
const save = (k, v) => STORE.set(k, v);
// Cached issues keep a shortened description; opening one fetches it in full.
const slim = (i) => (i?.description?.length > 3000 ? { ...i, description: i.description.slice(0, 3000) } : i);
const stop = (_e, cx) => cx.stop_propagation();
const cycleName = (c, tr) => c.name ? (c.number ? `${c.name} · ${c.number}` : c.name) : `${tr.cycle} ${c.number ?? "?"}`;

export default class Linear extends View {
  init(_props, cx) {
    this.focusUntil = Date.now() + 2000;
    this.config = { agent: ["claude"], agentName: null, refreshSeconds: 120, taskContext: true, cacheDays: 30, worktreeMod: null,
      worktreeRepo: null, branchPrefix: null };
    this.branchPrefix = null;
    this.origin = props()?.origin ? this.placeOf(props().origin) : this.focusedPlace();
    this.views = [];
    this.viewsAt = 0;
    this.errors = [];
    this.viewData = {};
    this.viewer = null;
    this.mine = [];
    this.peopleBy = {};
    this.projects = { query: "", nodes: [], cursor: null, more: false };
    this.favorites = [];
    this.recentItems = [];
    this.homeTab = "projects";
    this.homeSel = 0;
    this.cache = {}; // identifier → issue
    this.recent = []; // identifiers, newest first
    this.found = []; // identifiers in the focused terminal shown on top, last mentioned first
    this.foundIds = []; // every identifier the terminal mentions, cached or not
    this.details = {}; // identifier → detail
    this.tab = "mine";
    this.sel = 0;
    const given = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(String(props()?.open ?? "")) ? String(props().open).toUpperCase() : null;
    const opening = given ?? (props()?.open === "current" ? this.guessBranchIssue() : null);
    this.mode = opening ? "detail" : props()?.side ? "list" : "home"; // home | list | detail
    this.stack = opening ? [opening] : []; // issues followed through relations in the detail view
    this.sc = {}; // issue id → the detail's scroll: offset, measured heights, outline state
    this.places = new Places();
    this.canWrite = false;
    this.connecting = false;
    this.sending = false;
    this.statePick = null;
    this.draftFor = null;
    this.draftMode = { mode: "new" };
    this.composing = false;
    this.draft = TextareaState.new({ rows: 3 });
    this.draft.set_auto_grow(3, 12);
    this.draft.on("change", (_e, cx) => { this.trackMention(); cx.notify(); });
    this.draft.on("submit", (e, cx) => { if (e?.secondary) this.sendComment(cx); });
    this.draft.on("focus", (_e, cx) => { this.composing = true; cx.notify(); });
    this.draft.on("blur", (_e, cx) => { this.composing = false; cx.timer.after(200, (cx) => { if (!this.composing) { this.mention = null; cx.notify(); } }); cx.notify(); });
    this.places.rename = (branch) => this.ownBranch(branch);
    this.pick = null; // { issue, sel }: choosing where the agent works
    this.status = null; // { text, level }
    this.flash = null;
    this.loading = new Set();
    this.width = 900;
    this.layout = "list";
    this.layouts = {};
    this.projectPane = {};
    this.overviews = {};
    this.sort = { by: "default", asc: false }; // list order (default: the list's own)
    this.hideClosed = false; // Display: leave completed, canceled and duplicate issues out of the lists
    this.nest = true; // Display: sub-issues under their parent
    this.pop = null;
    this.popMenu = null; // the display panel's open choice (order, closed)
    this.collapsed = new Set(); // parents whose sub-issues are folded in the list
    this.dataVer = 0; this.foldVer = 0; // bumped when cached issues or folds change (rows() is memoized on them)
    this.height = 700;
    this.lightbox = null; // { urls, idx }: an image shown large over the window
    this.typing = false;
    this.finding = false;
    this.handle = cx.focus_handle();
    this.listScroll = ScrollHandle.new();
    this.homeScroll = ScrollHandle.new();
    this.wheel = {};
    this.queryGen = 0; this.flashGen = 0;
    this.images = new Images();

    this.findInput = InputState.new({ placeholder: "" });
    this.findInput.on("change", (_e, cx) => { this.sel = 0; this.fillBoard(cx); cx.notify(); });
    this.findInput.on("focus", (_e, cx) => { this.finding = true; this.typing = true; cx.notify(); });
    this.findInput.on("blur", (_e, cx) => { this.finding = false; this.typing = false; cx.notify(); });
    this.findInput.on("submit", (_e, cx) => this.activate(this.selected(), cx));
    this.homeInput = InputState.new({ placeholder: "" });
    this.homeInput.on("change", (_e, cx) => this.onHomeQuery(this.homeInput.value(), cx));
    this.homeInput.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.homeInput.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });

    this.titleInput = InputState.new({ placeholder: "" });
    this.titleInput.on("change", (_e, cx) => cx.notify());
    this.titleInput.on("submit", (_e, cx) => { if (this.issueEdit?.field === "title") this.saveIssue(cx); });
    this.titleInput.on("focus", (_e, cx) => { this.editFocus = "title"; cx.notify(); });
    this.titleInput.on("blur", (_e, cx) => { if (this.editFocus === "title") this.editFocus = null; this.leaveEdit("title", cx); });
    this.creating = null;
    this.shortcuts = false;
    this.actionsOpen = false;
    this.newTitle = InputState.new({ placeholder: "" });
    this.newTitle.on("change", (_e, cx) => cx.notify());
    this.newTitle.on("submit", () => this.newBody.focus());
    this.newTitle.on("focus", () => { if (this.creating) this.creating.field = "title"; });
    this.newBody = TextareaState.new({ rows: 8 });
    this.newBody.on("change", (_e, cx) => cx.notify());
    this.newBody.on("submit", (e, cx) => { if (e?.secondary) this.createIssue(cx); });
    this.newBody.on("focus", () => { if (this.creating) this.creating.field = "body"; });
    this.bodyDraft = TextareaState.new({ rows: 10 });
    this.bodyDraft.set_auto_grow(8, 40);
    this.bodyDraft.on("change", (_e, cx) => cx.notify());
    this.bodyDraft.on("submit", (e, cx) => { if (e?.secondary) this.saveIssue(cx); });
    this.bodyDraft.on("focus", (_e, cx) => { this.editFocus = "body"; cx.notify(); });
    this.bodyDraft.on("blur", (_e, cx) => { if (this.editFocus === "body") this.editFocus = null; this.leaveEdit("body", cx); });

    this.assignInput = InputState.new({ placeholder: "" });
    this.assignInput.on("change", (_e, cx) => { if (this.assignPick) this.assignPick.sel = 0; cx.notify(); });
    this.assignInput.on("submit", (_e, cx) => { const list = this.assignChoices(); this.pickAssignee(list[Math.min(this.assignPick?.sel ?? 0, list.length - 1)], cx); });
    // Priority, labels, project, cycle and due date: one picker, its search box doubles as the date field.
    this.propPick = null;
    this.teamCycles = {};
    this.propInput = InputState.new({ placeholder: "" });
    this.propInput.on("change", (_e, cx) => { if (this.propPick) this.propPick.sel = 0; if (this.propPick?.kind === "project") this.searchProjects(cx); cx.notify(); });
    this.propInput.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.propInput.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    cx.spawn(async (cx) => {
      // Read the focused terminal right away, so its issues are on the first frame and the list doesn't jump.
      const termText = this.readTerminal();
      await this.loadConfig();
      this.places.worktreeMod = this.config.worktreeMod ?? null;
      this.linearConnected().then((on) => { this.canWrite = on; cx.notify(); });
      this.places.preferred = this.config.worktreeRepo ? String(this.config.worktreeRepo).replace(/^~(?=\/|$)/, home()) : null;
      this.findPrefix().then((p) => { this.branchPrefix = p; });
      // Show the cache first, then fetch in the background.
      await STORE.load();
      this.viewer = load("viewer", null);
      this.people = load("people", []);
      if (!this.people.length || Date.now() - load("peopleAt", 0) > 86400000) {
        api.people().then((list) => { if (list.length) { this.people = list; save("people", list); save("peopleAt", Date.now()); } }).catch(() => {});
      }
      this.mine = load("mine", []);
      this.peopleBy = load("peopleBy", {});
      this.cache = load("cache", {});
      this.recent = load("recent", []);
      this.tab = isViewTab(load("tab", "mine")) ? load("tab", "mine") : "mine";
      this.details = load("details", {});
      this.layout = LAYOUTS.includes(load("layout", "list")) ? load("layout", "list") : "list";
      this.layouts = load("layouts", {});
      if (LAYOUTS.includes(this.layouts[load("tab", "")])) this.layout = this.layouts[load("tab", "")];
      this.sort = { by: "default", asc: false, ...load("sort", {}) };
      this.hideClosed = load("hideClosed", false);
      this.nest = load("nest", this.config.nestSubIssues !== false);
      this.collapsed = new Set(load("collapsed", []));
      this.favorites = load("favorites", null) ?? ((await VIEWS.read(null)) ?? load("myViews", [])).map((v) => (v.kind === "project" ? api.projectOf(v) : api.viewItem(v)));
      this.recentItems = load("recentItems", []);
      this.homeTab = load("homeTab", "projects");
      this.projects = { ...this.projects, nodes: load("projects", []) };
      this.views = load("views", []);
      this.viewData = load("viewData", {});
      if (isViewTab(this.tab) && !this.viewOf(this.tab)) this.tab = "mine";
      this.cleanCache();
      if (this.config.terminalIssues !== false) {
        this.foundIds = Q.issueRefs(await termText, this.teamKeys());
        this.found = this.foundIds.filter((id) => this.cache[id]);
      }
      if (props()?.open === "current" && this.viewer) this.openCurrent(cx);
      else if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(String(props()?.open ?? ""))) { this.openedCurrent = true; this.openDetail(String(props().open).toUpperCase(), cx, true); }
      cx.notify();
      if (this.mode === "home") this.focusHome(); else this.focusList();
      this.fetchFound(cx);
      if (this.mode === "home") { this.loadProjects(cx); this.loadViews(cx); }
      // The shown issue's comments first: requests queue in the runtime, and the lists are big.
      const shown = this.shownId();
      if (shown) await this.loadDetail(cx, shown, true);
      await this.refresh(cx, true);
      if (props()?.open === "current" && !this.openedCurrent) this.openCurrent(cx);
      await this.prefetchDetails(cx);
      await this.places.scanAll();
    });
    cx.timer.every(2000, () => { STORE.flush(); });
    cx.timer.every(Math.max(10, this.config.refreshSeconds) * 1000, (cx) => { if (this.viewer) this.refresh(cx, false); });
    // Redraw once a second only while an issue tab has a working agent (the elapsed time).
    cx.timer.every(250, () => this.keepFocus());
    cx.timer.every(1000, (cx) => {
      if (spaces().some((s) => s.tabs.some((tb) => tb.working_since && tb.name.match(IDENT_IN_NAME)))) this.redraw(cx);
    });
    cx.timer.after(400, () => { if (this.mode === "home") this.focusHome(); else if (!this.typing) this.focusList(); });
    // The loop must end when nextCommand() stops waiting (an empty answer after a reload or close),
    // or it spins without ever yielding and freezes the whole window.
    cx.spawn(async (cx) => {
      let burst = 0, since = Date.now();
      for (;;) {
        let c;
        try { c = await nextCommand(); } catch { return; }
        if (c === undefined || c === null || c === "") return;
        if (Date.now() - since > 1000) { burst = 0; since = Date.now(); }
        if (++burst > 50) return;
        const [name, arg] = String(c).split(/[:\s]+/, 2);
        if (name === "home") { if (!props()?.side) this.goHome(cx); }
        else if (name === "refresh") this.reload(cx);
        else if (name === "close") this.dismiss();
        else if (name === "sort" && SORTS.includes(arg)) this.setSort(arg, cx);
        else if (name === "display") this.openPop(this.pop === name ? null : name, cx);
        else if (name === "layout") this.setLayout(LAYOUTS.includes(arg) ? arg : this.nextLayout(), cx);
        else if (name === "open" && arg) this.openDetail(arg.toUpperCase(), cx, true);
        else if (name === "comments") { const id = this.shownId(); if (id) this.toggleComments(id, cx); }
        else if (name === "jump" && arg) { const id = this.shownId(); const key = /^jump[:\s](.*)$/s.exec(String(c))?.[1]; if (id && key) this.jump(id, key, cx); }
        else if (name === "image") { const g = this.gallery(); if (g.length) this.openLightbox(g[0], cx); }
        else if (name === "work") { const id = this.shownId(); const i = id && (this.details[id]?.issue ?? this.cache[id]); if (i) this.work(i, cx); }
        else if (name === "current") this.openCurrent(cx);
        cx.notify();
      }
    });
  }

  // config.json next to this file (optional):
  // { "language": "en" | "ko", "agent": ["claude"], "agentName": "Claude", "refreshSeconds": 120,
//   "taskContext": true, "terminalIssues": true, "nestSubIssues": true }
  async loadConfig() {
    try {
      const c = JSON.parse(await fs.readFile(`${appHome()}/${BASE}/config.json`, "utf8"));
      Object.assign(this.config, c);
    } catch {}
    api.setRunner((calls) => this.linearBatch(calls));
    setLanguage(this.config.language ?? "en", appWindow()?.platform);
  }

  agentName() {
    return agentName(this.config);
  }

  // ── Data ──────────────────────────────────────────────

  remember(list) {
    this.dataVer++;
    for (const i of list) if (i?.identifier) this.cache[i.identifier] = slim(this.filled(i));
    const ids = Object.keys(this.cache);
    if (ids.length > CACHE_MAX) {
      const keep = new Set([...this.recent, ...this.mine.map((i) => i.identifier)]);
      ids.sort((a, b) => (this.cache[a].updatedAt ?? "").localeCompare(this.cache[b].updatedAt ?? ""));
      for (const id of ids.slice(0, ids.length - CACHE_MAX)) if (!keep.has(id)) delete this.cache[id];
    }
    save("cache", this.cache);
  }

  filled(i) {
    const prev = this.cache[i.identifier], parent = i.parent && this.cache[i.parent.identifier];
    let out = i;
    if (!out.attachments && prev?.attachments) out = { ...out, attachments: prev.attachments };
    if (out.parent && !out.parent.title && parent) out = { ...out, parent: { ...out.parent, id: parent.id, title: parent.title, state: parent.state } };
    return out;
  }

  async call(cx, label, fn) {
    this.loading.add(label); this.redraw(cx);
    try {
      const r = await fn();
      if (this.status?.level === "error") this.status = null;
      return r;
    } catch (e) {
      this.logError(label, e);
      if (e?.kind === "auth") this.canWrite = false;
      this.status = { text: T().err[e?.kind] ?? String(e?.message ?? e), level: "error", kind: e?.kind };
      return undefined;
    } finally {
      this.loading.delete(label); this.redraw(cx);
    }
  }

  logError(label, e) {
    const detail = [e?.kind && `kind: ${e.kind}`, String(e?.message ?? e), e?.stack].filter(Boolean).join("\n");
    this.errors = [...this.errors.slice(-19), { at: new Date().toISOString(), label, detail }];
  }

  errorReport() {
    return this.errors.map((x) => `[${x.at}] ${x.label}\n${x.detail}`).join("\n\n");
  }

  // Background redraws wait while the left button is held on the detail: a redraw in the middle of a
  // drag can drop the text selection. The release (or a 10 s safety) draws what was held.
  redraw(cx) { if (this.holding) this.heldDraw = true; else cx.notify(); }
  hold(cx) {
    this.holding = true;
    const gen = (this.holdGen = (this.holdGen ?? 0) + 1);
    cx.timer.after(10000, (cx) => { if (gen === this.holdGen) this.release(cx); });
  }
  release(cx) {
    if (!this.holding) return;
    this.holding = false;
    if (this.heldDraw) { this.heldDraw = false; cx.notify(); }
  }

  teamIds() { return (this.viewer?.teams?.nodes ?? []).map((t) => t.id); }
  teamKeys() { return this.viewer?.teamKeys?.length ? this.viewer.teamKeys : (this.viewer?.teams?.nodes ?? []).map((t) => t.key); }

  async findPrefix() {
    if (this.config.branchPrefix) return this.config.branchPrefix;
    const r = await exec("glab", ["api", "user"]).catch(() => null);
    try { return JSON.parse(r?.stdout ?? "").username || null; } catch { return null; }
  }

  ownBranch(branch) {
    if (this.branchPrefix) return `${this.branchPrefix}/${branch.slice(branch.indexOf("/") + 1)}`;
    return branch;
  }

  async linearConnected() {
    const r = await exec("node", [CLI(), "status"]).catch(() => null);
    try { return JSON.parse(r?.stdout ?? "").connected === true; } catch { return false; }
  }

  async linearBatch(calls) {
    return this.linearMe(null, calls);
  }

  async linearMe(tool, args) {
    const dir = `${appHome()}/${BASE}/.cache`;
    const file = `${dir}/call-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    let r;
    try {
      await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", dir]);
      await fs.writeFile(file, JSON.stringify(args));
      r = await exec("node", [CLI(), ...(tool ? ["call", tool] : ["batch"]), `@${file}`], { timeout: 60000 });
    } finally {
      await exec("rm", ["-f", file]).catch(() => {});
    }
    let out = null;
    try { out = JSON.parse(String(r.stdout).trim().split("\n").pop()); } catch {}
    if (!out?.ok) throw new Error(out?.error ?? (r.stderr || r.stdout || "linear-me failed").trim());
    return out.value;
  }

  connect(cx) {
    if (this.connecting) return;
    this.connecting = true;
    this.say(T().connecting, cx);
    cx.spawn(async (cx) => {
      const r = await exec("node", [CLI(), "login"], { timeout: 330000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
      this.connecting = false;
      this.canWrite = await this.linearConnected();
      if (this.canWrite) cx.spawn(async (cx) => this.refresh(cx));
      this.say(this.canWrite ? T().connected : `${T().connectFailed}: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}`, cx, this.canWrite ? "success" : "error");
    });
  }

  async write(tool, args, done, cx) {
    if (!this.canWrite || this.sending) return false;
    this.sending = true;
    this.say(T().saving, cx);
    try {
      const value = await this.linearMe(tool, args);
      this.say(typeof done === "function" ? done(value) : done, cx, "success");
      return value ?? true;
    } catch (e) {
      this.say(`${T().writeFailed}: ${e?.message ?? e}`, cx, "error");
      return false;
    } finally {
      this.sending = false;
      cx.notify();
    }
  }

  openComposer(id, cx, mode = { mode: "new" }) {
    if (!this.canWrite) { this.say(T().connectFirst, cx); return; }
    if (this.draftFor !== id || JSON.stringify(this.draftMode) !== JSON.stringify(mode)) {
      this.draftFor = id;
      this.draftMode = mode;
      this.draftText = mode.mode === "edit" ? mode.body ?? "" : "";
      this.mention = null;
      this.draft.set_value(this.draftText);
    }
    cx.timer.after(0, () => this.draft.focus());
    cx.notify();
  }

  trackMention() {
    const text = this.draft.value(), prev = this.draftText ?? "";
    this.draftText = text;
    const at = text === prev ? null : mentionAt(text, editPoint(prev, text));
    this.mention = at ? { ...at, sel: this.mention?.query === at.query ? this.mention.sel : 0 } : null;
  }

  mentionChoices() {
    if (!this.mention) return [];
    const d = this.details[this.draftFor], i = d?.issue ?? this.cache[this.draftFor];
    const preferred = new Set([i?.assignee?.id, i?.creator?.id, ...(d?.comments ?? []).map((c) => c.user?.id)].filter(Boolean));
    return rankPeople(this.people ?? [], this.mention.query, preferred);
  }

  pickMention(p, cx) {
    if (!this.mention || !p) return;
    const { text, cursor } = insertMention(this.draft.value(), this.mention, p.displayName);
    this.mention = null;
    this.draftText = text;
    this.draft.set_value(text);
    this.draft.set_selected_range({ start: cursor, end: cursor });
    this.draft.focus();
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

  askerAlive(id) {
    const term = this.askers?.[id];
    return Boolean(term) && terminals().some((x) => x.address === term && x.state === "live");
  }

  async showRight(cx, term) {
    const shown = () => panes().some((p) => p.terminal === term);
    for (let n = 0; n < 40 && !shown(); n++) {
      if (n % 4 === 0 && terminals().some((x) => x.address === term && x.state === "live")) run("terminal.keep", { terminal: term, place: "right" });
      await new Promise((r) => cx.timer.after(250, () => r()));
    }
    return shown();
  }

  askClaude(issue, cx, question = null) {
    if (!issue || Date.now() - (this.askedAt ?? 0) < 800) return;
    this.askedAt = Date.now();
    const id = issue.identifier, tr = T();
    const agent = this.agentName();
    this.say(tr.askStarting(id, agent), cx);
    cx.spawn(async (cx) => {
      try {
        let term = this.askers?.[id];
        if (this.askerAlive(id)) {
          if (question) {
            const r = await hc(["send", term, question]);
            if (r.code !== 0) throw new Error((r.stderr || r.stdout || "").trim() || "hc send failed");
          }
        } else {
          const brief = await this.taskFor(issue, false, cx, tr.askTask(issue));
          const text = question ? `${brief}\n\n${tr.askQuestion}: ${question}` : brief;
          const argv = askArgv(this.config, ASK_DENY);
          const cwd = this.places.preferred || home();
          const name = `ask-${id.toLowerCase()}-${Date.now().toString(36)}`;
          const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name, "--cwd", cwd, "--", ...argv, text]);
          if (r.code !== 0) throw new Error((r.stderr || r.stdout || "").trim());
          term = JSON.parse(r.stdout).address ?? name;
          this.askers = { ...(this.askers ?? {}), [id]: term };
        }
        const shown = await this.showRight(cx, term);
        const pane = panes().find((p) => p.terminal === term)?.pane;
        if (pane && !question) run("pane.focus", { pane });
        this.say(shown ? (question ? tr.askSent(id, agent) : tr.askReady(id, agent)) : tr.askBackground(id, agent), cx, "success");
      } catch (e) {
        this.askedAt = 0;
        this.say(`${tr.askFailed(agent)}: ${e?.message ?? e}`, cx, "error");
      }
    });
  }

  askFromComposer(cx) {
    const id = this.draftFor, question = this.draft.value().trim();
    const issue = id ? (this.details[id]?.issue ?? this.cache[id]) : null;
    if (!issue) return;
    if (!question) { this.askClaude(issue, cx); return; }
    this.askClaude(issue, cx, question);
    this.draftText = "";
    this.draft.set_value("");
    this.draftFor = null;
    this.draftMode = { mode: "new" };
    this.closeComposer(cx);
  }

  closeComposer(cx) {
    if (!this.draft.value().trim()) { this.draftFor = null; this.draftMode = { mode: "new" }; }
    this.composing = false;
    this.focusList();
    cx.notify();
  }

  sendComment(cx) {
    const id = this.draftFor, m = this.draftMode, body = this.draft.value().trim();
    if (!id || this.sending) return;
    if (!body) { this.say(T().commentEmpty, cx); return; }
    const args = m.mode === "edit" ? { id: m.commentId, body } : { issueId: id, body, ...(m.mode === "reply" ? { parentId: m.parentId } : {}) };
    cx.spawn(async (cx) => {
      if (!(await this.write("save_comment", args, m.mode === "edit" ? T().commentEdited : T().commentSent(id), cx))) return;
      this.draftText = "";
      this.draft.set_value("");
      this.draftFor = null; this.draftMode = { mode: "new" };
      this.focusList();
      await this.loadDetail(cx, id, true);
      if (m.mode === "new") this.jump(id, "end", cx);
      cx.notify();
    });
  }

  assignMe(issue, cx) {
    if (!issue) return;
    if (!this.canWrite) { this.say(T().connectFirst, cx); return; }
    cx.spawn(async (cx) => {
      if (await this.write("save_issue", { id: issue.identifier, assignee: "me" }, T().assigned(issue.identifier), cx)) {
        await this.loadDetail(cx, issue.identifier, true);
        this.refresh(cx, false);
      }
    });
  }

  // The title or the description turns into a field where it is, as in Linear. Leaving the field saves.
  editIssue(id, cx, field = "body") {
    if (!this.canWrite) { this.say(T().connectFirst, cx); return; }
    const focus = () => cx.timer.after(0, () => (field === "title" ? this.titleInput : this.bodyDraft).focus());
    if (this.issueEdit?.id === id && this.issueEdit.field === field && !this.issueEdit.saving) { focus(); return; }
    const start = () => {
      const issue = this.details[id]?.issue ?? this.cache[id];
      if (!issue) return;
      this.issueEdit = { id, field, title: issue.title ?? "", description: issue.description ?? "" };
      this.titleInput.set_value(this.issueEdit.title);
      this.bodyDraft.set_value(this.issueEdit.description);
      focus();
      cx.notify();
    };
    if (this.details[id]) start();
    else cx.spawn(async (cx) => { await this.loadDetail(cx, id); start(); });
  }

  // A field lost the focus: save what changed, or just close it.
  leaveEdit(field, cx) {
    const e = this.issueEdit;
    if (!e || e.field !== field || e.saving) { cx.notify(); return; }
    if (this.issueEdited()) this.saveIssue(cx);
    else this.cancelEdit(cx, false);
  }

  issueEdited() {
    const e = this.issueEdit;
    return Boolean(e) && (this.titleInput.value().trim() !== e.title || this.bodyDraft.value() !== e.description);
  }

  cancelEdit(cx, refocus = true) {
    this.issueEdit = null;
    this.editFocus = null;
    if (refocus) this.focusList();
    cx.notify();
  }

  saveIssue(cx) {
    const e = this.issueEdit;
    if (!e || e.saving || this.sending) return;
    const title = this.titleInput.value().trim(), description = this.bodyDraft.value();
    if (!title) { this.say(T().titleEmpty, cx); this.titleInput.set_value(e.title); this.cancelEdit(cx); return; }
    if (!this.issueEdited()) { this.cancelEdit(cx); return; }
    const args = { id: e.id, ...(title !== e.title ? { title } : {}), ...(description !== e.description ? { description } : {}) };
    // Shown right away; Linear's answer replaces it.
    const issue = this.details[e.id]?.issue;
    if (issue) { if (args.title) issue.title = title; if ("description" in args) issue.description = description; }
    e.saving = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const ok = await this.write("save_issue", args, T().issueSaved(e.id), cx);
      if (this.issueEdit === e) {
        if (ok) this.cancelEdit(cx, this.editFocus !== null);
        else { e.saving = false; cx.notify(); }
      }
      await this.loadDetail(cx, e.id, true);
      if (ok) this.refresh(cx, false);
      cx.notify();
    });
  }

  openCreate(cx) {
    if (!this.canWrite) { this.say(T().connectFirst, cx); return; }
    if (!(this.viewer?.teams?.nodes ?? []).length) { this.say(T().noTeam, cx); return; }
    this.creating = { ...this.createContext(), mine: load("newMine", true) };
    cx.timer.after(0, () => this.newTitle.focus());
    cx.notify();
  }

  createContext() {
    const teams = this.viewer?.teams?.nodes ?? [];
    const teamBy = (key) => teams.find((tm) => tm.id === key || tm.key === key)?.id ?? null;
    const issues = this.rows().filter((r) => r.kind === "issue").map((r) => r.issue);
    const common = (keyOf) => {
      if (issues.length < 2) return [];
      const counts = new Map();
      for (const issue of issues) for (const [key, val] of keyOf(issue)) counts.set(key, { val, n: (counts.get(key)?.n ?? 0) + 1 });
      return [...counts.values()].filter((x) => x.n === issues.length).map((x) => x.val);
    };
    const id = this.shownId(), shown = id ? (this.details[id]?.issue ?? this.cache[id]) : null;
    const view = this.viewOf(this.tab), proj = this.projectTab();
    const team = [view?.team?.id, view?.team?.key, ...common((i) => [[i.team?.key, i.team?.key]]), shown?.team?.id, shown?.team?.key, load("newTeam", null)]
      .map((x) => x && teamBy(x)).find(Boolean) ?? teams[0].id;
    const project = proj ? { id: proj.id, name: proj.name } : common((i) => (i.project ? [[i.project.id ?? i.project.name, i.project]] : []))[0] ?? null;
    const labels = [...new Set(common((i) => (i.labels?.nodes ?? []).map((l) => [l.name, l.name])))];
    return { team, project, labels, priority: null };
  }

  closeCreate(cx) {
    this.creating = null;
    this.focusList();
    cx.notify();
  }

  createTeam(step, cx) {
    const teams = this.viewer?.teams?.nodes ?? [], c = this.creating;
    const n = teams.findIndex((tm) => tm.id === c.team);
    c.team = teams[(n + step + teams.length) % teams.length].id;
    cx.notify();
  }

  createIssue(cx) {
    const c = this.creating;
    if (!c || this.sending) return;
    const title = this.newTitle.value().trim(), description = this.newBody.value().trim();
    if (!title) { this.say(T().titleEmpty, cx); return; }
    save("newTeam", c.team); save("newMine", c.mine);
    const args = { team: c.team, title, ...(description ? { description } : {}), ...(c.mine ? { assignee: "me" } : {}),
      ...(c.project ? { project: c.project.id ?? c.project.name } : {}), ...(c.labels.length ? { labels: c.labels } : {}), ...(c.priority ? { priority: c.priority } : {}) };
    const created = (v) => v?.identifier ?? v?.issue?.identifier ?? /\b[A-Z][A-Z0-9]*-\d+\b/.exec(typeof v === "string" ? v : JSON.stringify(v ?? ""))?.[0] ?? null;
    cx.spawn(async (cx) => {
      const value = await this.write("save_issue", args, (v) => T().issueCreated(created(v)), cx);
      if (!value) return;
      this.newTitle.set_value(""); this.newBody.set_value("");
      this.closeCreate(cx);
      const id = created(value);
      if (id) this.openDetail(id, cx, true);
      this.refresh(cx, false);
    });
  }

  createKey(k, cx) {
    if (k === "cmd-enter" || k === "ctrl-enter") this.createIssue(cx);
    else if (k === "escape") this.closeCreate(cx);
    else if (k === "ctrl-t") this.createTeam(1, cx);
    else if (k === "ctrl-shift-t") this.createTeam(-1, cx);
    else if (k === "ctrl-m") { this.creating.mine = !this.creating.mine; cx.notify(); }
    else if (k === "tab" && this.creating.field === "title") this.newBody.focus();
    else return false;
    return true;
  }

  // Actions → Start a new worktree with agent: Herdr's New worktree, filled in from the issue (its
  // branch, the id as the space name, the issue as the agent's task), with the skills to pick there.
  openStart(issue, cx) {
    if (this.sending) return;
    this.say(T().starting, cx);
    cx.spawn(async (cx) => {
      try {
        const parent = await this.parentRepo();
        if (!parent) { this.say(T().noParentRepo, cx, "error"); return; }
        const task = await this.taskFor(issue, false, cx);
        await this.places.start(this.places.worktreeIn(parent, this.ownBranch(issueBranch(issue))),
          { name: issue.identifier, argv: agentArgv(this.config), task, space: issue.identifier });
        this.dismiss();
      } catch (e) {
        this.status = { text: `${T().pickFailed}: ${e?.message ?? e}`, level: "error" };
        cx.notify();
      }
    });
  }

  // The git repo the agent works in: the parent repo of where Linear was opened from, the
  // focused pane, or worktreeRepo. undefined while looking, null when there is none.
  parentRepo() {
    const f = this.focusedPlace();
    const space = spaces().find((x) => x.id === focused()?.space);
    return this.places.parentRepo([this.origin?.cwd, f?.cwd, space?.folder, this.places.preferred]);
  }

  createView(t) {
    const tr = T(), c = this.creating, teams = this.viewer?.teams?.nodes ?? [];
    const chip = (id, on, label, action) => h_flex().id(id).h(24).px(9).items_center().rounded(12).border_1().text_size(11.5).cursor_pointer()
      .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => action(cx)).child(label);
    const panel = v_flex().id("new-issue").w(560).max_w_full().gap(10).p(16).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .on_mouse_down("left", stop).on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(div().text_size(14).font_semibold().child(tr.newIssue))
      .child(h_flex().gap(6).flex_wrap().items_center()
        .children(teams.map((tm) => chip(`nt-${tm.id}`, tm.id === c.team, tm.key, (cx) => { c.team = tm.id; cx.notify(); })))
        .child(div().flex_1())
        .child(chip("n-mine", c.mine, tr.assignedToMe, (cx) => { c.mine = !c.mine; cx.notify(); })))
      .when(Boolean(c.project || c.labels.length || c.priority), (el) => el.child(h_flex().gap(6).flex_wrap().items_center()
        .when(Boolean(c.project), (el) => el.child(chip("n-project", true, `${tr.projectWord} ${c.project.name}  ×`, (cx) => { c.project = null; cx.notify(); })))
        .when(Boolean(c.priority), (el) => el.child(chip("n-prio", true, `${tr.priority[c.priority]}  ×`, (cx) => { c.priority = null; cx.notify(); })))
        .children(c.labels.map((name) => chip(`n-l-${name}`, true, `${name}  ×`, (cx) => { c.labels = c.labels.filter((x) => x !== name); cx.notify(); })))))
      .child(h_flex().h(36).px(10).items_center().rounded(8).border_1().bg(t.background).border_color(t.border)
        .child(Input.new(this.newTitle).flex_1().h_full().text_size(15)))
      .child(div().w_full().min_w(0).rounded(8).border_1().bg(t.background).border_color(t.border)
        .child(Textarea.new(this.newBody).w_full()))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(11).text_color(t.dim).child(tr.newIssueHint))
        .child(this.button(t, "n-cancel", tr.cancel, (cx) => this.closeCreate(cx)))
        .child(this.button(t, "n-create", this.sending ? tr.saving : tr.create, (cx) => this.createIssue(cx), Boolean(this.newTitle.value().trim()) && !this.sending)));
    return h_flex().absolute().inset_0().items_center().justify_center().bg("#00000066")
      .child(div().id("new-back").absolute().inset_0().on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.closeCreate(cx); }))
      .child(panel);
  }

  openAssign(id, cx) {
    if (!this.canWrite) { this.say(T().connectFirst, cx); return; }
    if (this.assignPick?.id === id) { this.closeAssign(cx); return; }
    this.statePick = null; this.propPick = null;
    this.assignPick = { id, sel: 0 };
    this.assignInput.set_value("");
    cx.timer.after(0, () => this.assignInput.focus());
    cx.notify();
  }

  closeAssign(cx) {
    this.assignPick = null;
    this.focusList();
    cx.notify();
  }

  assignChoices() {
    const p = this.assignPick;
    if (!p) return [];
    const d = this.details[p.id], issue = d?.issue ?? this.cache[p.id];
    const q = this.assignInput.value().trim();
    const me = this.viewer?.id;
    const preferred = new Set([issue?.creator?.id, ...(d?.comments ?? []).map((c) => c.user?.id)].filter(Boolean));
    const people = rankPeople((this.people ?? []).filter((x) => x.id !== issue?.assignee?.id), q, preferred, 8);
    const mine = people.findIndex((x) => x.id === me);
    if (mine > 0) people.unshift(...people.splice(mine, 1));
    const rows = people.map((x) => ({ kind: "person", person: x }));
    return issue?.assignee && !q ? [{ kind: "none" }, ...rows] : rows;
  }

  pickAssignee(row, cx) {
    const p = this.assignPick;
    if (!p || !row) return;
    this.closeAssign(cx);
    const who = row.kind === "none" ? null : row.person;
    cx.spawn(async (cx) => {
      if (await this.write("save_issue", { id: p.id, assignee: who ? who.id : null }, who ? T().assignedTo(p.id, who.name) : T().unassignedFrom(p.id), cx)) {
        await this.loadDetail(cx, p.id, true);
        this.refresh(cx, false);
      }
    });
  }

  assignKey(k, cx) {
    const p = this.assignPick, list = this.assignChoices(), n = list.length;
    if (k === "escape") { this.closeAssign(cx); return true; }
    if (!n) return false;
    if (k === "down" || k === "ctrl-n" || k === "tab") p.sel = (p.sel + 1) % n;
    else if (k === "up" || k === "ctrl-p" || k === "shift-tab") p.sel = (p.sel + n - 1) % n;
    else if (k === "enter") { this.pickAssignee(list[Math.min(p.sel, n - 1)], cx); return true; }
    else return false;
    cx.notify();
    return true;
  }

  openStates(id, cx) {
    const issue = this.details[id]?.issue ?? this.cache[id];
    if (!issue?.team?.id) return;
    if (!this.canWrite) { this.say(T().connectFirst, cx); return; }
    this.assignPick = null; this.propPick = null;
    this.statePick = { id, states: null, sel: 0 };
    cx.notify();
    cx.spawn(async (cx) => {
      const states = await this.call(cx, "states", () => api.teamStates(issue.team.id));
      if (this.statePick?.id !== id) return;
      this.statePick = { id, states: states ?? [], sel: Math.max(0, (states ?? []).findIndex((x) => x.name === issue.state?.name)) };
      cx.notify();
    });
  }

  pickState(st, cx) {
    const p = this.statePick;
    this.statePick = null;
    cx.notify();
    if (!p || !st) return;
    cx.spawn(async (cx) => {
      if (await this.write("save_issue", { id: p.id, state: st.id }, T().stateSet(p.id, st.name), cx)) {
        await this.loadDetail(cx, p.id, true);
        this.refresh(cx, false);
      }
    });
  }

  stateKey(k, cx) {
    const p = this.statePick, list = p.states ?? [], n = list.length;
    if (k === "escape") { this.statePick = null; cx.notify(); return true; }
    if (!n) return false;
    if (k === "down" || k === "ctrl-n") p.sel = (p.sel + 1) % n;
    else if (k === "up" || k === "ctrl-p") p.sel = (p.sel + n - 1) % n;
    else if (k === "enter") { this.pickState(list[p.sel], cx); return true; }
    else if (/^[1-9]$/.test(k) && Number(k) <= n) { this.pickState(list[Number(k) - 1], cx); return true; }
    else return false;
    cx.notify();
    return true;
  }

  // ── Property picker ───────────────────────────────────
  // kind: priority | labels | project | cycle | due. `items` is null while loading.

  openProp(id, kind, cx) {
    const issue = this.details[id]?.issue ?? this.cache[id];
    if (!issue) return;
    if (!this.canWrite) { this.say(T().connectFirst, cx); return; }
    if (this.propPick?.id === id && this.propPick.kind === kind) { this.closeProp(cx); return; }
    this.statePick = null; this.assignPick = null;
    this.propPick = { id, kind, items: kind === "priority" || kind === "due" ? [] : null, sel: 0, found: null };
    this.propInput.set_value("");
    cx.timer.after(0, () => this.propInput.focus());
    cx.notify();
    const team = issue.team?.id;
    const load = (fn) => cx.spawn(async (cx) => {
      const items = await this.call(cx, kind, fn);
      if (this.propPick?.id !== id || this.propPick.kind !== kind) return;
      this.propPick.items = items ?? [];
      cx.notify();
    });
    if (kind === "labels") load(() => api.teamLabels(team));
    else if (kind === "cycle") load(async () => (this.teamCycles[team] = await api.teamCycles(team)));
    else if (kind === "project") this.searchProjects(cx);
  }

  closeProp(cx) {
    this.propPick = null;
    this.focusList();
    cx.notify();
  }

  searchProjects(cx) {
    const p = this.propPick, q = this.propInput.value().trim();
    if (!p || p.kind !== "project" || p.found === q) return;
    p.found = q;
    cx.spawn(async (cx) => {
      const r = await this.call(cx, "projects", () => api.projects(q));
      if (this.propPick !== p || p.found !== q) return;
      p.items = r?.nodes ?? [];
      cx.notify();
    });
  }

  // The rows the picker shows: { key, label, color?, icon?, on?, value }.
  propChoices() {
    const p = this.propPick;
    if (!p) return [];
    const tr = T(), issue = this.details[p.id]?.issue ?? this.cache[p.id];
    const q = this.propInput.value().trim().toLowerCase();
    const match = (r) => !q || r.label.toLowerCase().includes(q);
    if (p.kind === "priority") {
      return [0, 1, 2, 3, 4].map((n) => ({ key: `p${n}`, label: n ? tr.priority[n] : tr.noPriority, prio: n, on: (issue?.priority ?? 0) === n, value: n })).filter(match);
    }
    if (p.kind === "due") {
      const days = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
      const friday = (5 - new Date().getDay() + 7) % 7 || 7;
      const monday = (8 - new Date().getDay()) % 7 || 7;
      const typed = parseDay(this.propInput.value());
      const rows = [
        typed && { key: "typed", label: typed, value: typed },
        { key: "today", label: `${tr.dueToday} · ${days(0)}`, value: days(0) },
        { key: "tomorrow", label: `${tr.dueTomorrow} · ${days(1)}`, value: days(1) },
        { key: "friday", label: `${tr.dueFriday} · ${days(friday)}`, value: days(friday) },
        { key: "monday", label: `${tr.dueNextWeek} · ${days(monday)}`, value: days(monday) },
        { key: "2w", label: `${tr.dueTwoWeeks} · ${days(14)}`, value: days(14) },
        issue?.dueDate && { key: "none", label: tr.dueClear, value: null, none: true },
      ].filter(Boolean);
      return typed ? rows : rows.filter(match);
    }
    if (!p.items) return [];
    if (p.kind === "labels") {
      const mine = new Set((issue?.labels?.nodes ?? []).map((l) => l.name));
      return p.items.map((l) => ({ key: l.id, label: l.group ? `${l.group} › ${l.name}` : l.name, name: l.name, color: l.color, on: mine.has(l.name), value: l }))
        .filter(match).sort((a, b) => Number(b.on) - Number(a.on)).slice(0, 60);
    }
    if (p.kind === "project") {
      const rows = p.items.map((x) => ({ key: x.id, label: x.name, color: x.color, on: issue?.project?.id === x.id || issue?.project?.name === x.name, value: x }));
      return issue?.project && !q ? [{ key: "none", label: tr.noProject, value: null, none: true }, ...rows] : rows;
    }
    if (p.kind === "cycle") {
      const rows = p.items.map((c) => ({ key: c.id, label: cycleName(c, tr), on: issue?.cycle?.id === c.id, value: c })).filter(match);
      return issue?.cycle && !q ? [{ key: "none", label: tr.noCycle, value: null, none: true }, ...rows] : rows;
    }
    return [];
  }

  pickProp(row, cx) {
    const p = this.propPick;
    if (!p || !row) return;
    const tr = T(), id = p.id, d = this.details[id], issue = d?.issue ?? this.cache[id];
    let args, done;
    if (p.kind === "labels") {
      // Several labels in a row: the picker stays open and the issue changes right away.
      const name = row.name, on = !row.on;
      const nodes = issue.labels?.nodes ?? [];
      issue.labels = { nodes: on ? [...nodes, { id: row.value.id, name, color: row.value.color }] : nodes.filter((l) => l.name !== name) };
      args = on ? { id, addLabels: [row.value.id] } : { id, removeLabels: [row.value.id] };
      done = on ? tr.labelOn(id, name) : tr.labelOff(id, name);
      cx.notify();
    } else {
      this.closeProp(cx);
      if (row.on) return;
      if (p.kind === "priority") { args = { id, priority: row.value }; done = tr.prioritySet(id, row.value ? tr.priority[row.value] : tr.noPriority); }
      else if (p.kind === "project") { args = { id, project: row.value ? row.value.id : null }; done = tr.projectSet(id, row.value?.name ?? tr.noProject); }
      else if (p.kind === "cycle") { args = { id, cycle: row.value ? row.value.id : null }; done = tr.cycleSet(id, row.value ? cycleName(row.value, tr) : tr.noCycle); }
      else if (p.kind === "due") { args = { id, dueDate: row.value }; done = tr.dueSet(id, row.value ?? tr.noDue); }
    }
    // Label clicks can come faster than Linear answers: the saves go one after the other.
    cx.spawn((cx) => (this.propSaves = (this.propSaves ?? Promise.resolve()).then(async () => {
      const ok = await this.write("save_issue", args, done, cx);
      await this.loadDetail(cx, id, true);
      if (ok) this.refresh(cx, false);
    }).catch(() => {})));
  }

  propKey(k, cx) {
    const p = this.propPick;
    if (!p) return false;
    if (k === "escape") { this.closeProp(cx); return true; }
    const list = this.propChoices(), n = list.length;
    if (!n) return false;
    p.sel = Math.min(p.sel, n - 1);
    if (k === "down" || k === "ctrl-n" || k === "tab") p.sel = (p.sel + 1) % n;
    else if (k === "up" || k === "ctrl-p" || k === "shift-tab") p.sel = (p.sel + n - 1) % n;
    else if (k === "enter") { this.pickProp(list[p.sel], cx); return true; }
    else return false;
    cx.notify();
    return true;
  }

  async findMe() {
    const me = await api.viewer();
    if (!me) throw new Error(T().noUser);
    return me;
  }

  async refresh(cx, first) {
    if (!this.viewer) {
      const v = await this.call(cx, "viewer", () => this.findMe());
      if (!v) return;
      this.viewer = v; save("viewer", v);
    } else if (first) {
      this.call(cx, "viewer", () => this.findMe()).then((v) => { if (v) { this.viewer = v; save("viewer", v); } });
    }
    const viewId = viewIdOf(this.tab);
    const [mine] = await Promise.all([
      this.call(cx, "mine", () => api.myIssues(this.viewer.id)),
      viewId ? this.loadView(cx, viewId) : null,
    ]);
    if (mine) { this.mine = mine; save("mine", mine.map(slim)); this.remember(mine); }
    const shown = this.shownId();
    if (shown) this.loadDetail(cx, shown, true);
    if (this.mode === "home") { this.loadProjects(cx); this.loadViews(cx); }
    this.redraw(cx);
    this.fillBoard(cx);
  }

  async loadView(cx, viewId, more = false) {
    if (this.loading.has(`v:${viewId}`)) return;
    const have = this.viewData[viewId];
    if (more && !have?.more) return;
    const isProject = this.viewOf(`${VIEW_TAB}${viewId}`)?.kind === "project";
    const page = await this.call(cx, `v:${viewId}`, () => (isProject ? api.projectIssues : api.viewIssues)(viewId, more ? have.cursor : null));
    if (!page) return;
    const fresh = new Set(page.nodes.map((i) => i.id));
    const nodes = more ? [...(have?.nodes ?? []), ...page.nodes.filter((i) => !(have?.nodes ?? []).some((x) => x.id === i.id))]
      : [...page.nodes, ...(have?.nodes ?? []).slice(api.PAGE_SIZE).filter((i) => !fresh.has(i.id))];
    this.viewData = { ...this.viewData, [viewId]: { nodes, cursor: page.pageInfo.endCursor, more: page.pageInfo.hasNextPage } };
    save("viewData", Object.fromEntries(Object.entries(this.viewData).slice(-10)
      .map(([k, v]) => [k, { ...v, nodes: v.nodes.slice(0, api.PAGE_SIZE).map(slim) }])));
    this.remember(page.nodes);
    this.redraw(cx);
    this.fillBoard(cx);
  }

  goHome(cx) {
    this.mode = "home"; this.stack = []; this.pop = null; this.pick = null;
    this.focusHome();
    this.loadProjects(cx);
    this.loadViews(cx);
    cx.notify();
  }

  goList(tab, cx) {
    this.mode = "list";
    this.setTab(tab ?? "mine", cx);
    this.focusList();
  }

  onHomeQuery(_text, cx) {
    this.homeSel = 0;
    const mine = ++this.queryGen;
    cx.timer.after(300, (cx) => { if (mine === this.queryGen) this.loadProjects(cx); });
    cx.notify();
  }

  async loadProjects(cx, more = false) {
    const query = this.homeInput.value().trim();
    const have = this.projects;
    if (more && (!have.more || have.query !== query)) return;
    const key = more ? `projects:${query}:${have.cursor}` : `projects:${query}`;
    if (this.loading.has(key)) return;
    const page = await this.call(cx, key, () => api.projects(query, more ? have.cursor : null));
    if (!page || this.homeInput.value().trim() !== query) return;
    const nodes = more ? [...have.nodes, ...page.nodes.filter((p) => !have.nodes.some((x) => x.id === p.id))] : page.nodes;
    this.projects = { query, nodes, cursor: page.cursor, more: page.more };
    if (!query) save("projects", nodes.slice(0, api.PAGE_SIZE));
    this.freshen(page.nodes);
    this.redraw(cx);
  }

  async loadViews(cx) {
    if (Date.now() - this.viewsAt < this.config.refreshSeconds * 1000 || this.loading.has("views")) return;
    const views = await this.call(cx, "views", () => api.customViews());
    if (!views) return;
    this.views = views; this.viewsAt = Date.now(); save("views", views);
    this.freshen(views);
    this.redraw(cx);
  }

  freshen(list) {
    const fresh = new Map(list.map((x) => [x.id, x]));
    const update = (items) => items.map((x) => fresh.get(x.id) ?? x);
    this.favorites = update(this.favorites); save("favorites", this.favorites);
    this.recentItems = update(this.recentItems); save("recentItems", this.recentItems);
  }

  homeRows() {
    const typed = this.homeInput.value().trim();
    const q = typed.toLowerCase();
    const match = (p) => !q || p.name.toLowerCase().includes(q);
    const views = this.homeTab === "views";
    const kind = views ? "view" : "project";
    const favIds = new Set(this.favorites.map((x) => x.id));
    const favs = this.favorites.filter((x) => x.kind === kind && match(x));
    const recents = this.recentItems.filter((x) => x.kind === kind && !favIds.has(x.id) && match(x));
    const shown = new Set([...favs, ...recents].map((x) => x.id));
    const all = views ? this.views.filter((v) => !shown.has(v.id) && match(v))
      : this.projects.nodes.filter((p) => !shown.has(p.id) && (this.projects.query === typed || match(p)));
    const tr = T();
    const section = (text, list) => (list.length ? [{ kind: "head", text }, ...list.map((x) => ({ kind: "item", item: x, fav: favIds.has(x.id) }))] : []);
    return [...(q ? [] : [{ kind: "tickets" }]), ...section(tr.favorites, favs), ...section(tr.recentItems, recents),
      ...section(views ? tr.allViews : tr.allProjects, all)];
  }

  setHomeTab(tab, cx) {
    this.homeTab = tab; save("homeTab", tab); this.homeSel = 0;
    this.homeScroll.scroll_to_item(0);
    if (tab === "views") this.loadViews(cx); else this.loadProjects(cx);
    cx.notify();
  }

  homePickable() { return this.homeRows().filter((r) => r.kind !== "head"); }

  homeSelected() {
    const p = this.homePickable();
    return p[Math.min(this.homeSel, p.length - 1)] ?? null;
  }

  moveHome(d, cx) {
    const pick = this.homePickable();
    if (!pick.length) return;
    this.homeSel = Math.max(0, Math.min(pick.length - 1, this.homeSel + d));
    const on = pick[this.homeSel];
    this.homeScroll.scroll_to_item(this.homeRows().findIndex((r) => r.kind === on.kind && r.item?.id === on.item?.id));
    if (this.homeTab === "projects" && this.homeSel >= pick.length - MORE_AHEAD) this.loadProjects(cx, true);
    cx.notify();
  }

  activateHome(r, cx) {
    if (r?.kind === "tickets") this.goList(null, cx);
    else if (r?.kind === "item") this.openItem(r.item, cx);
  }

  openItem(p, cx) {
    this.recentItems = [p, ...this.recentItems.filter((x) => x.id !== p.id)].slice(0, RECENT_PROJECTS);
    save("recentItems", this.recentItems);
    const tab = `${VIEW_TAB}${p.id}`;
    if (p.kind === "project" && !LAYOUTS.includes(this.layouts[tab])) { this.layouts[tab] = "board"; save("layouts", this.layouts); }
    this.goList(tab, cx);
  }

  toggleFav(p, cx) {
    const on = this.favorites.some((x) => x.id === p.id);
    this.favorites = on ? this.favorites.filter((x) => x.id !== p.id) : [...this.favorites, p];
    save("favorites", this.favorites);
    const at = this.homePickable().findIndex((r) => r.item?.id === p.id);
    if (at >= 0) { this.homeSel = at; this.homeScroll.scroll_to_item(this.homeRows().findIndex((r) => r.item?.id === p.id)); }
    this.say(on ? T().favRemoved(p.name) : T().favAdded(p.name), cx, on ? "info" : "success");
    cx.notify();
  }

  homeKey(k, cx) {
    const r = this.homeSelected();
    const fav = () => r?.kind === "item" && this.toggleFav(r.item, cx);
    const m = {
      down: () => this.moveHome(1, cx), up: () => this.moveHome(-1, cx),
      "ctrl-n": () => this.moveHome(1, cx), "ctrl-p": () => this.moveHome(-1, cx),
      pagedown: () => this.moveHome(10, cx), pageup: () => this.moveHome(-10, cx),
      enter: () => this.activateHome(r, cx),
      tab: () => this.setHomeTab(this.homeTab === "views" ? "projects" : "views", cx),
      "shift-tab": () => this.setHomeTab(this.homeTab === "views" ? "projects" : "views", cx),
      "cmd-d": fav, "ctrl-d": fav,
      escape: () => {
        if (!this.homeInput.value()) { this.dismiss(); return; }
        this.homeInput.set_value(""); this.onHomeQuery("", cx);
      },
    };
    if (!m[k]) return false;
    m[k]();
    return true;
  }

  projectTab() {
    const v = this.viewOf(this.tab);
    return v?.kind === "project" ? v : null;
  }

  overviewShown() { return Boolean(this.projectTab()) && this.projectPane[this.tab] === "overview" && this.mode === "list"; }

  setProjectPane(pane, cx) {
    const v = this.projectTab();
    if (!v) return;
    this.projectPane[this.tab] = pane;
    if (pane === "overview" && !this.overviews[v.id]) cx.spawn(async (cx) => this.loadOverview(cx, v.id));
    cx.notify();
  }

  async loadOverview(cx, id) {
    const p = await this.call(cx, `po:${id}`, () => api.projectOverview(id));
    if (p) { this.overviews[id] = p; this.redraw(cx); }
  }

  viewOf(tab) {
    const id = viewIdOf(tab);
    if (!id) return null;
    return [...this.favorites, ...this.recentItems, ...this.views].find((x) => x.id === id) ?? null;
  }

  tabLabel(tab) {
    return isViewTab(tab) ? this.viewOf(tab)?.name ?? T().views : T().tabs.mine;
  }

  async loadDetail(cx, id, force = false) {
    const have = this.details[id];
    if (!force && have && Date.now() - have.at < this.config.refreshSeconds * 1000) return;
    if (this.loading.has(`d:${id}`)) return;
    const d = await this.call(cx, `d:${id}`, () => api.issueDetail(id));
    if (d === null) { this.status = { text: T().notFound(id), level: "error" }; return; }
    if (!d) return;
    this.details[id] = d;
    this.remember([d.issue]);
    // Keep details of recent issues and the top of my list in the cache, for instant previews.
    const keep = new Set([...this.recent.slice(0, 20), ...this.mine.slice(0, 10).map((i) => i.identifier), id]);
    save("details", Object.fromEntries(Object.entries(this.details).filter(([k]) => keep.has(k)).slice(-30)));
    this.prefetchImages(cx, d);
    // An issue only carries its cycle's id: the team's cycles give the name.
    const team = d.issue.team?.id;
    if (d.issue.cycle?.id && team && !this.teamCycles[team]) {
      this.teamCycles[team] = [];
      const list = await this.call(cx, "cycles", () => api.teamCycles(team));
      if (list) { this.teamCycles[team] = list; cx.notify(); } else delete this.teamCycles[team];
    }
  }

  // Details (comments, relations) of the top rows, one at a time, so moving through the list is instant.
  async prefetchDetails(cx) {
    const ids = this.pickable().filter((r) => r.kind === "issue").slice(0, 8).map((r) => r.issue.identifier);
    for (const id of ids) {
      await this.loadDetail(cx, id);
    }
  }

  prefetchImages(cx, d) {
    const urls = [...imageUrls(d.issue.description), ...d.comments.flatMap((c) => imageUrls(c.body))];
    for (const url of urls) {
      if (this.images.get(url)) continue;
      cx.spawn(async (cx) => { await this.images.load(url); this.redraw(cx); });
    }
  }

  image(url) { return this.images.get(url); }

  // Tabs whose name holds an issue identifier are that issue's agent tabs; the most urgent wins.
  tabLinks() {
    const rank = { blocked: 4, working: 3, done: 2, idle: 1 };
    const all = panes(), out = {};
    const agentIn = (tabId) => all.find((p) => p.tab === tabId && p.program?.agent)?.program ?? null;
    const branchIn = (tabId) => all.find((p) => p.tab === tabId && p.program?.agent && p.branch)?.branch ?? all.find((p) => p.tab === tabId && p.branch)?.branch ?? null;
    const add = (id, tab, space) => {
      const r = rank[tab.status] ?? 0;
      if (!out[id] || r > out[id].r) out[id] = { tab, space, r, program: agentIn(tab.id), branch: branchIn(tab.id) ?? space.branch ?? null };
    };
    const list = spaces();
    for (const space of list) for (const tab of space.tabs) {
      for (const m of tab.name.matchAll(IDENT_IN_NAME)) add(m[0].toUpperCase(), tab, space);
    }
    for (const [id, w] of Object.entries(this.watches())) {
      const space = list.find((x) => x.id === w.space), tab = space?.tabs.find((x) => x.id === w.tab);
      if (tab) add(id, tab, space);
      if (out[id]) out[id].watching = w.kind;
    }
    return out;
  }

  watches() {
    const out = {};
    for (const term of terminals() ?? []) {
      const labels = term.labels ?? {};
      if (term.state !== "live" || !labels["herdr.tab"]) continue;
      for (const [k, v] of Object.entries(labels)) {
        const m = k.match(WATCH_LABEL);
        if (!m || !v || WATCH_RANK[m[1]] <= WATCH_RANK[out[m[2]]?.kind]) continue;
        out[m[2]] = { tab: labels["herdr.tab"], space: labels["herdr.space"], kind: m[1], terminal: term.address };
      }
    }
    return out;
  }

  assignedToMe(issue) { return Boolean(this.viewer?.id) && issue?.assignee?.id === this.viewer.id; }

  goTab(link) {
    run("space.select", { id: link.space.id });
    run("tab.select", { id: link.tab.id });
  }

  // The focused terminal's screen and recent history ("" when there's none or it can't be read).
  async readTerminal() {
    const term = focused()?.terminal;
    if (!term) return "";
    try { const r = await hc(["read", term, "--lines", "300"]); return r.code === 0 ? r.stdout : ""; } catch { return ""; }
  }

  // Issues the terminal mentions that aren't cached yet, in one request. They go below the ones
  // already shown, so nothing on screen moves.
  async fetchFound(cx) {
    const missing = (this.foundIds ?? []).filter((id) => !this.cache[id]);
    if (!missing.length) return;
    const got = await this.call(cx, "found", () => api.issuesById(missing));
    if (!got?.length) return;
    this.remember(got);
    this.found = [...this.found, ...missing.filter((id) => this.cache[id])];
    cx.notify();
  }

  placeOf(o) {
    const tab = o.tab ? spaces().flatMap((x) => x.tabs).find((x) => x.id === o.tab) : null;
    const watched = Object.entries(this.watches()).find(([, w]) => (o.terminal && w.terminal === o.terminal) || (!o.terminal && w.tab === o.tab))?.[0] ?? null;
    return { branch: o.branch ?? null, cwd: o.cwd ?? null, watched, tab: tab?.name ?? null };
  }

  focusedPlace() {
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const tab = f?.tab ? spaces().flatMap((x) => x.tabs).find((x) => x.id === f.tab) : null;
    const term = f?.terminal ?? pane?.terminal ?? null;
    const watched = Object.entries(this.watches()).find(([, w]) => w.terminal === term || (!term && w.tab === f?.tab))?.[0] ?? null;
    return { branch: pane?.branch ?? null, cwd: pane?.cwd ?? f?.cwd ?? null, watched, tab: tab?.name ?? null };
  }

  guessBranchIssue() {
    const m = [...String(this.origin?.branch ?? "").matchAll(IDENT_IN_TEXT)][0];
    return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
  }

  branchIssue() {
    const place = this.origin?.branch || this.origin?.cwd ? this.origin : this.focusedPlace();
    const keys = new Set(this.teamKeys());
    for (const text of [place.branch, place.cwd?.split("/").pop(), place.watched, place.tab]) {
      for (const m of String(text ?? "").matchAll(IDENT_IN_TEXT)) {
        const key = m[1].toUpperCase();
        if (keys.has(key)) return `${key}-${m[2]}`;
      }
    }
    return null;
  }

  openCurrent(cx) {
    this.openedCurrent = true;
    const id = this.branchIssue();
    if (id) { if (this.stack.length !== 1 || this.stack[0] !== id) this.openDetail(id, cx, true); return; }
    if (this.mode === "detail") { this.mode = "list"; this.stack = []; }
    const place = this.origin ?? this.focusedPlace();
    this.say(T().noBranchIssue(place.branch ?? place.cwd ?? "?"), cx);
  }

  // Everything rows() reads. A render asks for the rows several times (selection, preview, list),
  // and a search scores every cached issue, so it's computed once per change.
  rowsKey() {
    return [this.tab, this.mine, this.peopleBy, this.findInput.value(),
      this.found, this.recent, this.dataVer, this.foldVer, this.branchIssue(), this.sort.by, this.sort.asc, this.hideClosed, this.nest, this.viewData, this.layout];
  }

  rows() {
    const key = this.rowsKey();
    if (this.rowsMemo && key.every((v, n) => v === this.rowsMemoKey[n])) return this.rowsMemo;
    this.rowsMemoKey = key;
    this.rowsMemo = this.buildRows();
    this.pickMemo = this.rowsMemo.filter((r) => r.kind !== "head");
    return this.rowsMemo;
  }

  // Sub-issues go under their parent when both are in the list (in list order), as deep as they nest.
  // A parent in `collapsed` hides them. A sub-issue whose parent isn't in the list stays at the top level.
  nested(list, extra = {}) {
    if (!this.nest || this.layout === "board") return list.map((issue) => ({ kind: "issue", issue, ...extra }));
    const ids = new Set(list.map((i) => i.identifier));
    const kids = new Map();
    const roots = [];
    for (const issue of list) {
      const p = issue.parent?.identifier;
      if (p && p !== issue.identifier && ids.has(p)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(issue); }
      else roots.push(issue);
    }
    const out = [], seen = new Set();
    // guides: one entry per level for the tree lines: "line" (an ancestor's siblings continue below),
    // "none", and for the row's own level "mid" (├ more siblings below) or "end" (╰ the last one).
    const walk = (issue, depth, guides) => {
      if (seen.has(issue.identifier)) return;
      seen.add(issue.identifier);
      const ch = (kids.get(issue.identifier) ?? []).filter((c) => !seen.has(c.identifier));
      const folded = ch.length > 0 && this.collapsed.has(issue.identifier);
      out.push({ kind: "issue", issue, ...extra, depth, guides, kids: ch.length, folded, progress: this.subProgress(issue, ch) });
      if (folded) return;
      const up = guides.map((g) => (g === "mid" || g === "line" ? "line" : "none"));
      ch.forEach((c, n) => walk(c, depth + 1, [...up, n === ch.length - 1 ? "end" : "mid"]));
    };
    // A family goes where its best-placed member is (a search's top hit can be a sub-issue).
    const rank = new Map(list.map((i, n) => [i.identifier, n]));
    const best = (issue, seenUp = new Set()) => {
      if (seenUp.has(issue.identifier)) return Infinity;
      seenUp.add(issue.identifier);
      return Math.min(rank.get(issue.identifier), ...(kids.get(issue.identifier) ?? []).map((c) => best(c, seenUp)));
    };
    const order = roots.map((r) => [r, best(r)]).sort((a, b) => a[1] - b[1]).map(([r]) => r);
    for (const r of order) walk(r, 0, []);
    return out;
  }

  // The list in the chosen order; "default" keeps it as it came (the list's own order, or relevance).
  // Ties keep their order. Sub-issues still go under their parent (nested() places a family by its
  // best-placed member).
  sorted(list) {
    const { by, asc } = this.sort;
    if (by === "default") return asc ? [...list].reverse() : list;
    const key = {
      updated: (i) => i.updatedAt ?? "",
      created: (i) => i.createdAt ?? "",
      // Urgent first and no priority last, whichever way: 1 urgent … 4 low, 0 none.
      priority: (i) => (i.priority ? i.priority : 5),
      state: (i) => STATE_RANK[i.state?.type] ?? 9,
    }[by];
    // Dates read newest first; priority and state read top of the scale first.
    const dir = (by === "updated" || by === "created" ? -1 : 1) * (asc ? -1 : 1);
    return list.map((i, n) => [i, key(i), n])
      .sort((a, b) => (a[1] < b[1] ? -dir : a[1] > b[1] ? dir : 0) || (b[0].updatedAt ?? "").localeCompare(a[0].updatedAt ?? "") || a[2] - b[2])
      .map(([i]) => i);
  }

  visible(list) {
    if (!this.hideClosed) return list;
    return list.filter((i) => !CLOSED.has(i.state?.type));
  }

  // Picking the order: another one sets it (in its natural direction), the same one flips it.
  setSort(by, cx) {
    this.sort = by === this.sort.by && by !== "default" ? { by, asc: !this.sort.asc } : { by, asc: false };
    save("sort", this.sort);
    this.sel = 0;
    cx.notify();
  }

  // Sub-issues done of all, for a parent's progress ring: from its fetched detail when there is one
  // (every sub-issue), else from the sub-issues in the list. null when it has none.
  subProgress(issue, inList) {
    const all = this.details[issue.identifier]?.relations?.children;
    const list = all?.length ? all : inList;
    if (!list.length) return null;
    return { done: list.filter((c) => c.state?.type === "completed").length, total: list.filter((c) => !["canceled", "duplicate"].includes(c.state?.type)).length || list.length };
  }

  buildRows() {
    const out = [];
    const viewId = viewIdOf(this.tab);
    let list = viewId ? this.byTitle(this.byPeople(this.viewData[viewId]?.nodes ?? [])) : this.mine;
    const found = this.found.map((id) => this.cache[id] ?? this.details[id]?.issue).filter(Boolean);
    if (found.length) {
      const ids = new Set(found.map((i) => i.identifier));
      out.push({ kind: "head", text: T().foundHead(found.length) }, ...found.map((issue) => ({ kind: "issue", issue, found: true })));
      out.push({ kind: "head", text: this.tabLabel(this.tab) });
      list = list.filter((i) => !ids.has(i.identifier));
    }
    if (this.tab === "mine") {
      const b = this.branchIssue();
      const issue = b && !this.found.includes(b) && (this.cache[b] ?? this.details[b]?.issue);
      if (issue) { out.push({ kind: "issue", issue, pin: true }); list = list.filter((i) => i.identifier !== b); }
    }
    out.push(...this.nested(this.sorted(this.visible(list))));
    return out;
  }

  hasMore() {
    const viewId = viewIdOf(this.tab);
    return Boolean(viewId && this.viewData[viewId]?.more);
  }

  loadMore(cx) {
    const viewId = viewIdOf(this.tab);
    if (viewId) this.loadView(cx, viewId, true);
  }

  nearEnd(at, n, cx) {
    if (at < n - MORE_AHEAD || !this.hasMore()) return;
    cx.timer.after(0, (cx) => this.loadMore(cx));
  }

  pickable() { this.rows(); return this.pickMemo; }
  selected() { const p = this.pickable(); return p[Math.min(this.sel, p.length - 1)] ?? null; }
  shownId() {
    if (this.mode === "detail") return this.stack[this.stack.length - 1] ?? null;
    const r = this.selected();
    return r?.kind === "issue" ? r.issue.identifier : null;
  }

  move(d, cx) {
    const n = this.pickable().length;
    if (!n) return;
    this.sel = Math.max(0, Math.min(n - 1, this.sel + d));
    this.listScroll.scroll_to_item(this.rows().indexOf(this.selected()));
    this.nearEnd(this.sel, n, cx);
    cx.notify();
  }

  // Selects the issue `id` if it's a row (keeps the selection on the same issue when rows move).
  selectIssue(id, cx) {
    const n = this.pickable().findIndex((r) => r.kind === "issue" && r.issue.identifier === id);
    if (n < 0) return false;
    this.sel = n;
    return true;
  }

  // Folds or unfolds a parent's sub-issues (open: true unfolds, false folds, omitted flips).
  toggleFold(id, cx, open) {
    const cur = this.selected();
    const unfold = open ?? this.collapsed.has(id);
    if (unfold === !this.collapsed.has(id)) return;
    if (unfold) this.collapsed.delete(id); else this.collapsed.add(id);
    this.foldVer++;
    save("collapsed", [...this.collapsed].slice(-500));
    // A sub-issue that just got hidden hands the selection to its parent.
    if (cur?.kind === "issue" && !this.selectIssue(cur.issue.identifier, cx)) this.selectIssue(id, cx);
    cx.notify();
  }

  // ← folds (or goes to the parent), → unfolds (or goes to the first sub-issue).
  foldKey(d, cx) {
    const r = this.selected();
    if (r?.kind !== "issue") return;
    const id = r.issue.identifier;
    if (d > 0) {
      if (r.kids && r.folded) this.toggleFold(id, cx, true);
      else if (r.kids) this.move(1, cx);
    } else if (r.kids && !r.folded) this.toggleFold(id, cx, false);
    else if (r.depth && r.issue.parent && this.selectIssue(r.issue.parent.identifier, cx)) cx.notify();
  }

  setLayout(layout, cx) {
    this.layout = layout; save("layout", layout);
    this.layouts[this.tab] = layout; save("layouts", this.layouts);
    this.fillBoard(cx);
    cx.notify();
  }

  nextLayout() { return LAYOUTS[(LAYOUTS.indexOf(this.layout) + 1) % LAYOUTS.length]; }

  boardColumns() {
    const cols = new Map();
    this.pickable().forEach((r, index) => {
      if (r.kind !== "issue") return;
      const st = r.issue.state ?? {};
      const key = st.name ?? "?";
      if (!cols.has(key)) cols.set(key, { key, state: st, cards: [] });
      const col = cols.get(key);
      if ((st.position ?? Infinity) < (col.state.position ?? Infinity)) col.state = st;
      col.cards.push({ r, index });
    });
    for (const col of cols.values()) col.cards = this.boardTree(col.cards);
    return [...cols.values()].sort((a, b) => (BOARD_RANK[a.state.type] ?? 9) - (BOARD_RANK[b.state.type] ?? 9)
      || (a.state.position ?? 0) - (b.state.position ?? 0) || a.key.localeCompare(b.key));
  }

  boardTree(cards) {
    if (!this.nest) return cards;
    const here = new Set(cards.map((x) => x.r.issue.identifier));
    const kids = new Map(), roots = [], out = [], seen = new Set();
    for (const x of cards) {
      const id = x.r.issue.identifier, p = x.r.issue.parent?.identifier;
      if (p && p !== id && here.has(p)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(x); }
      else roots.push(x);
    }
    const walk = (x) => {
      const id = x.r.issue.identifier;
      if (seen.has(id)) return;
      seen.add(id);
      out.push(x);
      for (const c of kids.get(id) ?? []) walk(c);
    };
    roots.forEach(walk);
    for (const x of cards) if (!seen.has(x.r.issue.identifier)) out.push(x);
    return out;
  }

  boardMove(dx, dy, cx) {
    const cols = this.boardColumns();
    if (!cols.length) return;
    const found = cols.findIndex((col) => col.cards.some((x) => x.index === this.sel));
    const c = Math.max(0, Math.min(cols.length - 1, (found < 0 ? 0 : found) + dx));
    const at = found < 0 ? 0 : cols[found].cards.findIndex((x) => x.index === this.sel);
    this.sel = cols[c].cards[Math.max(0, Math.min(cols[c].cards.length - 1, at + dy))].index;
    cx.notify();
  }

  activate(r, cx) {
    if (!r) return;
    if (r.kind === "issue") this.openDetail(r.issue.identifier, cx, true);
  }

  openDetail(id, cx, reset) {
    this.stack = reset ? [id] : [...this.stack, id];
    this.mode = "detail";
    this.actionsOpen = false;
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    save("recent", this.recent);
    this.loadDetail(cx, id);
    this.focusList();
    cx.notify();
  }

  back(cx) {
    this.stack.pop();
    this.actionsOpen = false;
    if (!this.stack.length && props()?.side) { this.dismiss(); return; }
    if (!this.stack.length) { this.mode = "list"; this.focusList(); }
    else this.loadDetail(cx, this.stack[this.stack.length - 1]);
    cx.notify();
  }

  setTab(tab, cx) {
    if (tab !== this.tab) this.findInput.set_value("");
    this.tab = tab; save("tab", tab); this.sel = 0;
    if (LAYOUTS.includes(this.layouts?.[tab])) this.layout = this.layouts[tab];
    const viewId = viewIdOf(tab);
    if (viewId) cx.spawn(async (cx) => this.loadView(cx, viewId));
    cx.notify();
  }

  focusList() { this.typing = false; this.handle.focus(); }
  focusHome() { this.typing = true; this.homeInput.focus(); }

  reload(cx) {
    const id = this.mode === "detail" ? this.shownId() : null;
    this.say(T().refreshing, cx);
    cx.spawn(async (cx) => {
      if (id) await this.loadDetail(cx, id, true); else await this.refresh(cx, false);
      if (this.overviewShown()) await this.loadOverview(cx, this.projectTab().id);
      if (this.status?.level !== "error") this.say(T().refreshed, cx, "success");
    });
  }

  keepFocus() {
    if (this.handle.is_focused()) this.typing = false;
    if (props()?.overlay || this.typing || this.pop || this.mode === "home") return;
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const was = this.lastPane;
    this.lastPane = pane?.pane ?? null;
    if (this.handle.is_focused()) {
      if (pane?.mod === "linear") this.myPane = pane.pane;
      return;
    }
    const all = panes().filter((p) => p.mod === "linear");
    const own = this.myPane ?? (all.length === 1 ? all[0].pane : null);
    if (own && pane?.pane === own && was !== own) this.focusUntil = Date.now() + 1500;
    const target = own ?? (pane?.mod === "linear" ? pane.pane : null);
    if (target && pane?.pane === target && Date.now() < (this.focusUntil ?? 0)) this.focusList();
  }

  dismiss() {
    STORE.flush();
    const o = props()?.overlay;
    if (o) closeOverlay(o);
    else if (props()?.side && props()?.pane) run("pane.close", { pane: props().pane });
  }

  // Called by Herdr when the window goes: write what's pending.
  async close() {
    await STORE.flush();
  }

  // ── Agent ↔ Linear ────────────────────────────────────
  // The agent's first message: the issue, its description and recent comments, and the downloaded
  // images as local files (left out when the agent runs on another machine, where the paths don't exist).

  async taskFor(issue, remote, cx, asked = null) {
    const head = asked ?? T().task(issue);
    if (!this.config.taskContext) return head;
    const id = issue.identifier;
    try { await this.loadDetail(cx, id); } catch {}
    const d = this.details[id];
    if (!d) return head;
    const x = T().ctx;
    const imgs = []; // [label, path]
    const refs = {};
    const ref = async (url) => {
      if (refs[url]) return refs[url];
      let path = null;
      if (!remote && /^https:\/\//.test(url)) {
        await this.images.load(url);
        const img = this.images.get(url);
        if (img?.state === "ok") path = img.abs;
      }
      const label = `${x.image} ${imgs.length + 1}`;
      imgs.push([label, path ?? url]);
      return (refs[url] = label);
    };
    const flat = async (md, max) => {
      let out = "";
      // Images become [image n]; a table stays a table, its cells' images inline.
      const cell = async (c) => {
        let x = "";
        for (const p of splitImages(c)) x += p.kind === "text" ? p.text : `[${await ref(p.url)}]`;
        return x.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
      };
      for (const p of splitMarkdown(md ?? "")) {
        if (p.kind === "text") out += p.text;
        else if (p.kind === "img") out += `${p.link && p.alt ? `${p.alt} ` : ""}[${await ref(p.url)}]\n`;
        else {
          const line = async (r) => `| ${(await Promise.all(r.map(cell))).join(" | ")} |\n`;
          out += `\n${await line(p.head)}|${p.head.map(() => " --- ").join("|")}|\n`;
          for (const r of p.rows) out += await line(r);
          out += "\n";
        }
      }
      out = out.trim();
      return out.length > max ? `${out.slice(0, max)}…` : out;
    };
    const parts = [head];
    const desc = await flat(d.issue.description, 4000);
    if (desc) parts.push(`## ${x.description}\n${desc}`);
    const recent = d.comments.slice(-10);
    if (recent.length) {
      const lines = [];
      for (const c of recent) {
        const who = c.user?.displayName || c.user?.name || "?";
        lines.push(`- ${who} (${(c.createdAt ?? "").slice(0, 10)}): ${(await flat(c.body, 800)).replace(/\n+/g, " ")}`);
      }
      parts.push(`## ${x.comments(recent.length, d.comments.length)}\n${lines.join("\n")}`);
    }
    if (imgs.length) parts.push(`## ${remote ? x.imagesRemote : x.images}\n${imgs.map(([l, p]) => `- ${l}: ${p}`).join("\n")}`);
    return parts.join("\n\n");
  }

  // ── Actions ───────────────────────────────────────────

  say(text, cx, level = "info") {
    if (level === "error") this.logError("say", text);
    this.flash = { text, level };
    const gen = ++this.flashGen;
    cx.timer.after(1800, (cx) => { if (gen === this.flashGen) { this.flash = null; cx.notify(); } });
    cx.notify();
  }

  // ── Outline ───────────────────────────────────────────
  // The detail scrolls by our own offset (a plain scroll area can't be moved from code): the wheel moves
  // it, each item reports its height, so we know where every heading and thread is.

  scrollOf(id) {
    if (!this.sc[id]) this.sc[id] = { y: 0, view: 0, content: 0, h: {}, tops: {}, keys: ["top"], active: "top" };
    return this.sc[id];
  }

  maxScroll(S) { return Math.max(0, S.content - S.view); }

  scrollTo(id, y, cx) {
    const S = this.scrollOf(id);
    const next = Math.max(0, Math.min(this.maxScroll(S), y));
    if (Math.abs(next - S.y) < 0.5) return;
    S.y = next;
    cx.notify();
  }

  scrollBy(id, d, cx) { const S = this.scrollOf(id); this.scrollTo(id, Math.min(S.y, this.maxScroll(S)) + d, cx); }

  jump(id, key, cx) {
    const S = this.scrollOf(id);
    if (key === "end") S.y = Infinity; // clamped once the height is known
    else S.y = key === "top" ? 0 : Math.max(0, (S.tops[key] ?? 0) - 8);
    cx.notify();
  }

  // Tab: to the comments, or back to the top when already there.
  toggleComments(id, cx) {
    const S = this.scrollOf(id);
    const at = S.keys.indexOf(S.active), c = S.keys.indexOf("cmts");
    this.jump(id, c >= 0 && at >= c ? "top" : "cmts", cx);
  }

  stepOutline(id, dir, cx) {
    const S = this.scrollOf(id);
    const n = S.keys.indexOf(S.active);
    this.jump(id, S.keys[Math.max(0, Math.min(S.keys.length - 1, (n < 0 ? 0 : n) + dir))], cx);
  }

  // Records an element's height; true when it changed.
  measured(map, key, h) {
    if (Math.abs((map[key] ?? -1) - h) <= 0.5) return false;
    map[key] = h;
    return true;
  }

  // ── Cache ─────────────────────────────────────────────
  // What's kept on disk is what was used in the last cacheDays (30): older details and cached issues
  // (not mine or recently opened) are dropped, and images not shown since are deleted.

  cleanCache() {
    const days = Math.max(1, Number(this.config.cacheDays) || 30);
    const cut = Date.now() - days * 864e5;
    const keep = new Set([...this.recent, ...this.mine.map((i) => i.identifier)]);
    const details = Object.fromEntries(Object.entries(this.details).filter(([, d]) => (d?.at ?? 0) >= cut));
    if (Object.keys(details).length !== Object.keys(this.details).length) { this.details = details; save("details", details); }
    const cache = Object.fromEntries(Object.entries(this.cache).filter(([k, i]) => keep.has(k) || Date.parse(i?.updatedAt ?? "") >= cut));
    if (Object.keys(cache).length !== Object.keys(this.cache).length) { this.cache = cache; save("cache", cache); }
    exec("sh", ["-c", 'find "$1" -maxdepth 1 -type f ! -name data.json ! -name views.json ! -name prompts.json -mtime +"$2" -delete', "sh", `${appHome()}/${BASE}/.cache`, String(days)]).catch(() => {});
  }

  copy(text, what, cx) {
    cx.write_to_clipboard(text);
    const one = text.replace(/\s+/g, " ").trim();
    this.say(T().copied(what, one.length > 48 ? `${one.slice(0, 48)}…` : one), cx, "success");
  }
  openUrl(url, cx) { if (/^https?:/.test(url)) cx.open_url(url); }

  // Asks where to work, then opens a tab (or a worktree space) named after the issue, running
  // the agent with the issue as its first message.
  work(issue, cx) {
    const pick = this.pick = { issue, sel: 0, parent: undefined };
    cx.spawn(async (cx) => {
      const [parent] = await Promise.all([this.parentRepo(), this.places.scanAll()]);
      pick.parent = parent;
      cx.notify();
    });
    cx.notify();
  }

  choices() {
    const p = this.pick;
    if (!p) return [];
    const branch = this.ownBranch(issueBranch(p.issue));
    return parentChoices(this.places.choices(p.issue), p.parent, p.parent && this.places.worktreeIn(p.parent, branch));
  }

  startChoice(c, cx) {
    const issue = this.pick?.issue;
    if (!c || !issue) return;
    this.say(T().starting, cx);
    cx.spawn(async (cx) => {
      try {
        const remote = Boolean(c.space ? c.space.machine : c.machine);
        const task = await this.taskFor(issue, remote, cx);
        await this.places.start(c, { name: issue.identifier, argv: agentArgv(this.config), task });
        this.pick = null;
        this.dismiss();
      } catch (e) {
        this.status = { text: `${T().pickFailed}: ${e?.message ?? e}`, level: "error" };
        cx.notify();
      }
    });
  }

  pickKey(k, cx) {
    const list = this.choices();
    const n = list.length;
    const mv = (d) => { if (n) this.pick.sel = Math.max(0, Math.min(n - 1, this.pick.sel + d)); };
    const m = {
      down: () => mv(1), up: () => mv(-1), "ctrl-n": () => mv(1), "ctrl-p": () => mv(-1), tab: () => mv(1), "shift-tab": () => mv(-1),
      enter: () => this.startChoice(list[this.pick.sel], cx),
      escape: () => { this.pick = null; }, q: () => { this.pick = null; },
    };
    if (/^[1-9]$/.test(k) && Number(k) <= n) m[k] = () => this.startChoice(list[Number(k) - 1], cx);
    if (!m[k]) return false;
    m[k](); cx.notify(); return true;
  }

  onKey(e, cx) {
    const k = e.keystroke;
    if (k === "cmd-r" || k === "ctrl-r") { this.reload(cx); cx.stop_propagation(); return; }
    if (this.handle.is_focused()) this.typing = false;
    const id = this.shownId();
    const issue = id ? (this.details[id]?.issue ?? this.cache[id]) : null;
    if (k === "ctrl-/" || (this.shortcuts && k === "escape")) { this.shortcuts = !this.shortcuts; cx.notify(); cx.stop_propagation(); return; }
    if (this.creating) { if (this.createKey(k, cx)) cx.stop_propagation(); return; }
    if (this.actionsOpen && this.mode === "detail" && k === "escape") { this.actionsOpen = false; cx.notify(); cx.stop_propagation(); return; }
    if (this.finding && this.mode === "list") {
      if (k === "escape") { if (this.findInput.value()) { this.findInput.set_value(""); this.sel = 0; cx.notify(); } else this.focusList(); cx.stop_propagation(); }
      else if (k === "down" || k === "up") { this.move(k === "down" ? 1 : -1, cx); cx.stop_propagation(); }
      return;
    }
    if (this.editFocus) {
      if (k === "cmd-enter" || k === "ctrl-enter") { this.saveIssue(cx); cx.stop_propagation(); }
      else if (k === "escape") { this.focusList(); cx.stop_propagation(); }
      return;
    }
    if (this.composing) {
      if (this.mentionKey(k, cx)) { cx.stop_propagation(); return; }
      if (k === "cmd-enter" || k === "ctrl-enter") { this.sendComment(cx); cx.stop_propagation(); }
      else if (k === "alt-enter") { this.askFromComposer(cx); cx.stop_propagation(); }
      else if (k === "escape") { this.closeComposer(cx); cx.stop_propagation(); }
      return;
    }
    if (this.assignPick) {
      if (this.assignKey(k, cx)) cx.stop_propagation();
      return;
    }
    if (this.propPick) {
      if (this.propKey(k, cx)) cx.stop_propagation();
      return;
    }
    if (this.statePick && this.stateKey(k, cx)) { cx.stop_propagation(); return; }
    if (this.pop) {
      if (k === "escape") { this.openPop(null, cx); cx.stop_propagation(); }
      return;
    }
    if (this.lightbox) { this.lightboxKey(k, cx); cx.stop_propagation(); return; }
    if (this.pick) { if (this.pickKey(k, cx)) cx.stop_propagation(); return; }
    if (this.mode === "home") { if (this.homeKey(k, cx)) cx.stop_propagation(); return; }
    if (this.mode === "detail") {
      if (k === "escape" && this.issueEdit) { this.issueEdited() ? this.say(T().editPending, cx) : this.cancelEdit(cx); cx.stop_propagation(); return; }
      const m = {
        escape: () => this.back(cx), backspace: () => this.back(cx), q: () => this.dismiss(),
        o: () => issue && this.openUrl(issue.url, cx), y: () => issue && this.copy(issue.url, "URL", cx),
        i: () => issue && this.copy(issue.identifier, "ID", cx), c: () => issue && this.work(issue, cx), k: () => issue && this.askClaude(issue, cx),
        r: () => this.reload(cx),
        g: () => { const l = id && this.tabLinks()[id]; l ? this.goTab(l) : this.say(T().noTab, cx); },
        tab: () => id && this.toggleComments(id, cx),
        down: () => id && this.scrollBy(id, 60, cx), up: () => id && this.scrollBy(id, -60, cx),
        pagedown: () => id && this.scrollBy(id, this.scrollOf(id).view * 0.85, cx), pageup: () => id && this.scrollBy(id, -this.scrollOf(id).view * 0.85, cx),
        space: () => id && this.scrollBy(id, this.scrollOf(id).view * 0.85, cx), "shift-space": () => id && this.scrollBy(id, -this.scrollOf(id).view * 0.85, cx),
        home: () => id && this.jump(id, "top", cx), end: () => id && this.jump(id, "end", cx),
        "]": () => id && this.stepOutline(id, 1, cx), "[": () => id && this.stepOutline(id, -1, cx),
        "ctrl-l": () => this.setLayout(this.nextLayout(), cx),
        v: () => { const g = this.gallery(); g.length ? this.openLightbox(g[0], cx) : this.say(T().noImage, cx); },
        m: () => id && this.openComposer(id, cx),
        a: () => this.assignMe(issue, cx),
        "shift-a": () => id && this.openAssign(id, cx),
        s: () => id && this.openStates(id, cx),
        p: () => id && this.openProp(id, "priority", cx), l: () => id && this.openProp(id, "labels", cx),
        "shift-p": () => id && this.openProp(id, "project", cx), "shift-c": () => id && this.openProp(id, "cycle", cx),
        "shift-d": () => id && this.openProp(id, "due", cx),
        e: () => id && this.editIssue(id, cx),
        n: () => this.openCreate(cx),
      };
      if (!m[k]) return;
      m[k](); cx.stop_propagation(); return;
    }
    const m = {
      down: () => this.move(1, cx), up: () => this.move(-1, cx),
      "ctrl-n": () => this.move(1, cx), "ctrl-p": () => this.move(-1, cx),
      "/": () => viewIdOf(this.tab) && this.findInput.focus(),
      pagedown: () => this.move(10, cx), pageup: () => this.move(-10, cx),
      "ctrl-o": () => issue && this.openUrl(issue.url, cx),
      "ctrl-y": () => issue && this.copy(issue.url, "URL", cx),
      "ctrl-r": () => this.reload(cx),
      "ctrl-l": () => this.setLayout(this.nextLayout(), cx),
      "shift-o": () => this.projectTab() && this.setProjectPane(this.overviewShown() ? "issues" : "overview", cx),
      escape: () => (props()?.side ? this.dismiss() : this.goHome(cx)),
      backspace: () => !props()?.side && this.goHome(cx),
      enter: () => this.activate(this.selected(), cx),
      r: () => this.reload(cx), n: () => this.openCreate(cx),
      left: () => this.foldKey(-1, cx), right: () => this.foldKey(1, cx),
    };
    if (this.layout === "board") {
      Object.assign(m, { down: () => this.boardMove(0, 1, cx), up: () => this.boardMove(0, -1, cx), "ctrl-n": () => this.boardMove(0, 1, cx), "ctrl-p": () => this.boardMove(0, -1, cx),
        left: () => this.boardMove(-1, 0, cx), right: () => this.boardMove(1, 0, cx) });
    }
    if (!m[k]) return;
    m[k](); cx.stop_propagation();
  }

  // ── Drawing ───────────────────────────────────────────

  render() {
    const t = theme();
    const root = v_flex().id("linear-root").size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .track_focus(this.handle)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1 || Math.abs(size.height - this.height) > 1) { this.width = size.width; this.height = size.height; cx.notify(); }
      })
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_up("left", (_e, cx) => this.release(cx));
    this.links = this.tabLinks();
    if (this.pick) return root.child(this.header(t)).child(this.pickView(t)).child(this.footer(t));
    if (this.mode === "home") return root.child(this.header(t)).child(this.homeView(t)).child(this.footer(t))
      .when(Boolean(this.creating), (el) => el.child(this.createView(t)))
      .when(Boolean(this.shortcuts), (el) => el.child(this.shortcutsView(t)));
    const body = this.mode === "detail"
      ? this.detailView(t, this.stack[this.stack.length - 1])
      : this.overviewShown() ? this.overviewView(t, this.projectTab())
      : this.layout === "board" ? this.boardView(t)
      : this.listView(t);
    return root.child(this.header(t)).when(this.mode === "list", (el) => el.child(this.listBar(t))).child(body).child(this.footer(t))
      .when(Boolean(this.pop) && this.mode === "list", (el) => el.child(this.popView(t)))
      .when(Boolean(this.lightbox), (el) => el.child(this.lightboxView(t)))
      .when(Boolean(this.creating), (el) => el.child(this.createView(t)))
      .when(Boolean(this.shortcuts), (el) => el.child(this.shortcutsView(t)));
  }

  shortcutRows() {
    const tr = T();
    if (this.creating) return tr.keysNew;
    if (this.editFocus) return tr.keysEdit;
    if (this.composing) return tr.keysComment(this.agentName());
    if (this.mode === "detail") return tr.keysDetail(this.agentName(), this.canWrite);
    if (this.mode === "home") return tr.keysHome;
    return this.layout === "board" ? tr.keysBoard : tr.keysList;
  }

  shortcutsView(t) {
    return h_flex().id("shortcuts-back").absolute().inset_0().items_center().justify_center().bg("#0000002e")
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.shortcuts = false; cx.notify(); })
      .child(v_flex().id("shortcuts").w(440).max_h_full().p(14).gap(2).rounded(10).border_1().border_color(t.border).bg(t.popover).overflow_hidden()
        .on_mouse_down("left", stop).on_scroll_wheel((_e, cx) => cx.stop_propagation())
        .child(div().pb(8).text_size(13).font_semibold().child(T().shortcuts))
        .children(this.shortcutRows().map(([key, label], n) => h_flex().id(`shortcut-${n}`).h(26).gap(12).items_center()
          .child(div().flex_1().text_size(12.5).child(label))
          .child(div().px(6).py(1).rounded(4).bg(t.selected).text_size(11.5).child(key)))));
  }

  header(t) {
    const busy = this.loading.size > 0;
    return h_flex().h(42).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(this.breadcrumb(t))
      .when(Boolean(this.projectTab()) && this.mode === "list", (el) => el.child(h_flex().flex_none().p(2).gap(2).rounded(7).border_1().border_color(t.border)
        .children([["issues", T().projectIssues], ["overview", T().projectOverview]].map(([key, label]) => {
          const on = (this.projectPane[this.tab] ?? "issues") === key;
          return h_flex().id(`pp-${key}`).h(20).px(8).items_center().rounded(5).text_size(11.5).cursor_pointer()
            .bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(on ? t.selected : t.hover))
            .on_mouse_down("left", stop).on_click((_e, cx) => this.setProjectPane(key, cx)).child(label);
        }))))
      .child(div().flex_1())
      .when(busy, (el) => el.child(svg(`${ICON}/spinner.svg`).size(13).text_color(t.dim).spin(900)))
      .when(this.mode === "list", (el) => el.child(this.layoutSwitch(t)))
      .when(this.canWrite, (el) => el.child(this.iconButton(t, "l-new", "+", (cx) => this.openCreate(cx))))
      .child(this.iconButton(t, "l-refresh", "↻", (cx) => this.reload(cx)))
      .when(Boolean(props()?.overlay) || Boolean(props()?.side), (el) => el.child(this.iconButton(t, "l-close", svg(`${ICON}/close.svg`).size(13), () => this.dismiss())));
  }

  breadcrumb(t) {
    const fav = this.mode !== "home" ? this.viewOf(this.tab) : null;
    const crumbs = [{ key: "home", label: "Linear", go: props()?.side ? null : (cx) => this.goHome(cx) }];
    if (this.mode !== "home") crumbs.push({ key: "list", label: this.tabLabel(this.tab), go: this.mode === "detail" ? (cx) => this.toList(cx) : null, fav });
    if (this.mode === "detail") this.stack.forEach((id, n) => {
      const issue = this.details[id]?.issue ?? this.cache[id];
      const last = n === this.stack.length - 1;
      crumbs.push({ key: `i-${n}`, label: last && issue?.title ? `${id}  ${issue.title}` : id, go: last ? null : (cx) => this.toStack(n, cx) });
    });
    const sep = () => div().flex_none().text_size(13).text_color(t.dim).child("›");
    const items = [];
    crumbs.forEach((c, n) => {
      const last = n === crumbs.length - 1;
      if (n) items.push(sep());
      items.push(h_flex().id(`bc-${c.key}`).min_w(0).when(!last, (el) => el.flex_none()).when(last, (el) => el.flex_shrink_1())
        .h(26).px(6).items_center().rounded(6)
        .text_size(n ? 13 : 14).font_semibold().text_color(last ? t.foreground : t.muted)
        .when(Boolean(c.go), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => c.go(cx)))
        .child(div().min_w(0).truncate().child(c.label)));
      if (c.fav) {
        const on = this.favorites.some((x) => x.id === c.fav.id);
        items.push(h_flex().id("bc-fav").flex_none().size(24).items_center().justify_center().rounded(6).cursor_pointer()
          .text_color(on ? STAR : t.dim).hover((s) => s.bg(t.hover).text_color(STAR))
          .on_mouse_down("left", stop).on_click((_e, cx) => this.toggleFav(c.fav, cx))
          .child(svg(`${ICON}/${on ? "star-fill" : "star"}.svg`).size(15)));
      }
    });
    return h_flex().min_w(0).flex_shrink_1().gap(2).items_center().children(items)
      .child(div().flex_none().pl(6).text_size(11.5).text_color(t.dim).child(this.viewer?.organization?.name ?? ""));
  }

  toList(cx) {
    this.stack = [];
    this.mode = "list";
    this.actionsOpen = false;
    this.focusList();
    cx.notify();
  }

  toStack(n, cx) {
    this.stack = this.stack.slice(0, n + 1);
    this.actionsOpen = false;
    this.loadDetail(cx, this.stack[n]);
    cx.notify();
  }

  layoutSwitch(t) {
    const tr = T().layout;
    const seg = (key, label) => {
      const on = this.layout === key;
      return h_flex().id(`ly-${key}`).h(22).px(8).items_center().rounded(5).text_size(11.5)
        .bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.setLayout(key, cx)).child(label);
    };
    return h_flex().p(2).gap(2).rounded(7).border_1().border_color(t.border)
      .child(seg("list", tr.list)).child(seg("board", tr.board));
  }

  iconButton(t, id, label, action) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => action(cx)).child(label);
  }

  listBar(t) {
    return h_flex().px(12).py(8).gap(8).flex_none().items_center().border_b(1).border_color(t.border)
      .when(Boolean(viewIdOf(this.tab)), (el) => el.child(this.peopleButton(t)).child(this.findBox(t)))
      .child(div().flex_1())
      .child(this.popButton(t, "display", `${ICON}/sliders.svg`, T().display, this.sort.by !== "default" || this.sort.asc || this.hideClosed || !this.nest));
  }


  openPop(which, cx) {
    this.pop = which;
    this.popMenu = null;
    if (!which && this.mode === "list") this.focusList();
    cx.notify();
  }

  setDisplay(key, value, cx) {
    this[key] = value;
    save(key, value);
    this.sel = 0; this.popMenu = null;
    cx.notify();
  }

  resetDisplay(cx) {
    this.sort = { by: "default", asc: false }; save("sort", this.sort);
    this.setDisplay("hideClosed", false, cx);
    this.setDisplay("nest", this.config.nestSubIssues !== false, cx);
  }

  popButton(t, which, icon, label, dot) {
    const open = this.pop === which;
    return h_flex().id(`pb-${which}`).relative().size(34).flex_none().items_center().justify_center().rounded(8).border_1()
      .border_color(open ? t.accent : t.input).bg(open ? t.selected : t.background).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.openPop(open ? null : which, cx))
      .child(svg(icon).size(15).text_color(open || dot ? t.foreground : t.muted))
      .when(dot, (el) => el.child(div().absolute().top(4).right(4).size(7).rounded(4).bg(t.accent)));
  }

  // A popover: a transparent layer over the window (a press on it closes) and the panel under the buttons.
  popView(t) {
    const people = this.pop === "people";
    const panel = people ? this.peoplePanel(t) : this.displayPanel(t);
    const at = div().id("pop-panel").absolute().top(people ? 82 : 88);
    return div().absolute().inset_0()
      .child(div().id("pop-back").absolute().inset_0().on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.openPop(null, cx); }))
      .child((people ? at.left(12) : at.right(12)).on_mouse_down("left", stop).on_scroll_wheel((_e, cx) => cx.stop_propagation())
        .child(panel.rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()));
  }

  menuRow(t, id, on, action) {
    return h_flex().id(id).h(30).px(10).gap(9).items_center().rounded(6).flex_none().text_size(12.5).cursor_pointer()
      .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => action(cx));
  }

  displayPanel(t) {
    const tr = T();
    const select = (id, text, menu) => h_flex().id(id).h(28).px(10).gap(8).items_center().rounded(6).border_1()
      .border_color(this.popMenu === menu ? t.accent : t.border).bg(t.background).text_size(12.5).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.popMenu = this.popMenu === menu ? null : menu; cx.notify(); })
      .child(div().min_w(96).child(text)).child(div().text_size(10).text_color(t.dim).child("▾"));
    const row = (label, ...right) => h_flex().h(40).px(14).gap(8).items_center()
      .child(div().flex_1().text_size(12.5).text_color(t.muted).child(label)).children(right);
    const options = (menu, list, cur, pick) => this.popMenu !== menu ? null
      : v_flex().mx(10).mb(6).p(4).gap(1).rounded(8).border_1().border_color(t.border).bg(t.surface)
        .children(list.map(([key, text]) => this.menuRow(t, `pm-${menu}-${key}`, key === cur, (cx) => pick(key, cx))
          .child(div().w(14).flex_none().text_color(t.accent).child(key === cur ? "✓" : "")).child(div().flex_1().child(text))));
    const dir = h_flex().id("pd-dir").size(28).items_center().justify_center().rounded(6).border_1().border_color(t.border).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.sort = { ...this.sort, asc: !this.sort.asc }; save("sort", this.sort); this.sel = 0; cx.notify(); })
      .child(div().text_size(13).text_color(t.foreground).child(this.sort.asc ? "↑" : "↓"));
    const toggle = h_flex().id("pd-nest").w(36).h(20).p(2).rounded(10).cursor_pointer().bg(this.nest ? t.accent : t.border)
      .when(this.nest, (el) => el.justify_end()).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.setDisplay("nest", !this.nest, cx))
      .child(div().size(16).rounded(8).bg("#ffffff"));
    const orderOpts = options("order", SORTS.map((k) => [k, tr.sort[k]]), this.sort.by, (k, cx) => { this.sort = { by: k, asc: false }; save("sort", this.sort); this.sel = 0; this.popMenu = null; cx.notify(); });
    const closedOpts = options("closed", [["all", tr.closedAll], ["hide", tr.closedHide]], this.hideClosed ? "hide" : "all", (k, cx) => this.setDisplay("hideClosed", k === "hide", cx));
    return v_flex().w(320).py(6)
      .child(row(tr.ordering, dir, select("pd-order", tr.sort[this.sort.by], "order")))
      .when(Boolean(orderOpts), (el) => el.child(orderOpts))
      .child(row(tr.closedIssues, select("pd-closed", this.hideClosed ? tr.closedHide : tr.closedAll, "closed")))
      .when(Boolean(closedOpts), (el) => el.child(closedOpts))
      .child(row(tr.nestSub, toggle))
      .child(h_flex().mt(4).px(14).pt(8).gap(8).border_t(1).border_color(t.border).justify_end()
        .child(this.button(t, "pd-reset", tr.reset, (cx) => this.resetDisplay(cx))));
  }

  peopleOf() {
    const id = viewIdOf(this.tab);
    if (!id) return [];
    return this.peopleBy[id] ?? (this.viewer?.id ? [this.viewer.id] : []);
  }

  byTitle(list) {
    const q = this.findInput.value().trim().toLowerCase();
    if (!q) return list;
    return list.filter((i) => `${i.identifier} ${i.title ?? ""}`.toLowerCase().includes(q));
  }

  byPeople(list) {
    const ids = this.peopleOf();
    return ids.length ? list.filter((i) => ids.includes(i.assignee?.id ?? NOBODY)) : list;
  }

  peopleChoices() {
    const me = this.viewer, seen = new Map();
    for (const i of this.viewData[viewIdOf(this.tab)]?.nodes ?? []) {
      const a = i.assignee;
      if (a?.id && a.id !== me?.id && !seen.has(a.id)) seen.set(a.id, a.displayName ?? a.name);
    }
    for (const id of this.peopleOf()) if (id !== me?.id && id !== NOBODY && !seen.has(id)) seen.set(id, this.personName(id));
    const others = [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    return [...(me ? [{ id: me.id, name: T().me }] : []), ...others, { id: NOBODY, name: T().unassigned }];
  }

  personName(id) {
    const p = (this.people ?? []).find((u) => u.id === id);
    return p?.displayName ?? p?.name ?? id;
  }

  togglePerson(id, cx) {
    const view = viewIdOf(this.tab), now = this.peopleOf();
    this.peopleBy = { ...this.peopleBy, [view]: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] };
    save("peopleBy", this.peopleBy);
    this.sel = 0;
    this.fillBoard(cx);
    cx.notify();
  }

  everyone(cx) {
    this.peopleBy = { ...this.peopleBy, [viewIdOf(this.tab)]: [] };
    save("peopleBy", this.peopleBy);
    this.sel = 0;
    cx.notify();
  }

  findBox(t) {
    const q = this.findInput.value();
    return h_flex().id("l-find").h(28).w(320).flex_shrink_1().min_w(140).px(10).gap(8).items_center().rounded(8).border_1()
      .border_color(this.finding ? t.accent : t.input).bg(t.background).on_mouse_down("left", stop)
      .child(svg(`${ICON}/search.svg`).size(13).text_color(t.dim))
      .child(Input.new(this.findInput).flex_1().h_full().text_size(12.5).text_color(t.foreground))
      .when(!q, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(T().findTitle)))
      .when(Boolean(q), (el) => el.child(this.miniButton(t, "l-find-clear", "×", (cx) => { this.findInput.set_value(""); this.sel = 0; cx.notify(); })));
  }

  peopleButton(t) {
    const tr = T(), ids = this.peopleOf(), open = this.pop === "people";
    const names = this.peopleChoices().filter((p) => ids.includes(p.id)).map((p) => p.name);
    const label = !ids.length ? tr.everyone : names.length <= 2 ? names.join(", ") : `${names[0]} +${names.length - 1}`;
    return h_flex().id("pb-people").h(28).px(10).gap(6).flex_none().items_center().rounded(8).border_1()
      .border_color(open ? t.accent : ids.length ? t.accent : t.border).bg(open ? t.selected : t.background).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.openPop(open ? null : "people", cx))
      .child(svg(`${ICON}/person.svg`).size(14).text_color(ids.length ? t.accent : t.muted))
      .child(div().max_w(260).truncate().text_size(12).child(label))
      .child(div().text_size(10).text_color(t.dim).child("▾"));
  }

  peoplePanel(t) {
    const tr = T(), ids = this.peopleOf();
    const row = (key, on, label, action, avatar) => this.menuRow(t, `pp-${key}`, false, action)
      .child(div().size(14).flex_none().rounded(3).border_1().border_color(on ? t.accent : t.border).bg(on ? t.accent : t.popover))
      .when(Boolean(avatar), (el) => el.child(this.avatar(t, avatar, 16)))
      .child(div().flex_1().min_w(0).truncate().child(label));
    return v_flex().id("people-panel").w(260).max_h(420).p(4).gap(1).overflow_y_scrollbar()
      .child(row("all", !ids.length, tr.everyone, (cx) => this.everyone(cx)))
      .child(div().h(1).my(3).bg(t.border))
      .children(this.peopleChoices().map((p) => row(p.id, ids.includes(p.id), p.name, (cx) => this.togglePerson(p.id, cx), p.id === NOBODY ? null : p.name)));
  }

  listView(t) {
    const rows = this.rows();
    if (!rows.length) {
      const msg = this.loading.size ? T().loading : T().noIssues;
      if (!this.canWrite) return this.empty(t, msg).gap(10)
        .child(this.button(t, "l-connect", this.connecting ? T().connecting : T().connectLinear, (cx) => this.connect(cx)));
      return this.empty(t, msg);
    }
    const pickable = this.pickable();
    const sel = pickable[Math.min(this.sel, pickable.length - 1)];
    const height = rows.reduce((h, r) => h + this.rowHeight(r), 0);
    return v_flex().id("l-list").flex_1().w_full().min_h(0).py(4).overflow_y_scrollbar().track_scroll(this.listScroll)
      .on_scroll_wheel((e, cx) => { if (this.wheelNearEnd(`l:${this.tab}`, e, height)) this.nearEnd(Infinity, 0, cx); })
      .children(rows.map((r, n) => this.row(t, r, r === sel, pickable.indexOf(r), n)));
  }

  wheelNearEnd(key, e, height) {
    const view = e.bounds?.height ?? this.height;
    const max = Math.max(0, height - view);
    this.wheel[key] = Math.max(0, Math.min(max, (this.wheel[key] ?? 0) - (e.delta?.y ?? 0)));
    return e.delta?.y < 0 && max - this.wheel[key] < MORE_AHEAD * ROW_H;
  }

  homeView(t) {
    const tr = T();
    const rows = this.homeRows();
    const pick = rows.filter((r) => r.kind !== "head");
    const sel = pick[Math.min(this.homeSel, pick.length - 1)];
    const search = h_flex().px(12).py(8).flex_none().border_b(1).border_color(t.border)
      .child(h_flex().id("h-search").h(34).flex_1().px(10).gap(8).items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
        .on_mouse_down("left", stop)
        .child(svg(`${ICON}/search.svg`).size(14).text_color(t.dim))
        .child(Input.new(this.homeInput).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .when(!this.homeInput.value(), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(tr.homeFind))));
    const tabs = h_flex().px(12).pt(8).gap(6).flex_none().children([["projects", tr.homeProjects], ["views", tr.views]].map(([id, label]) => {
      const on = this.homeTab === id;
      return h_flex().id(`h-ht-${id}`).h(24).px(10).items_center().rounded(12).border_1().text_size(11.5).cursor_pointer()
        .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.setHomeTab(id, cx)).child(label);
    }));
    const head = v_flex().flex_none().child(search).child(tabs);
    const busy = [...this.loading].some((k) => k.startsWith("projects:") || k === "views");
    const none = this.homeTab === "views" ? tr.noViews : tr.noProjects;
    if (!rows.some((r) => r.kind === "item")) {
      const empty = this.empty(t, busy ? tr.loading : none);
      return v_flex().flex_1().min_h(0).child(head).child(rows[0]?.kind === "tickets" ? v_flex().py(4).child(div().h(ROW2_H).child(this.homeRow(t, rows[0], rows[0] === sel, 0, 0))) : div())
        .child(!this.canWrite ? empty.gap(10).child(this.button(t, "h-connect", this.connecting ? tr.connecting : tr.connectLinear, (cx) => this.connect(cx))) : empty);
    }
    const sizes = rows.map((r) => (r.kind === "head" ? HEAD_H : r.kind === "tickets" ? ROW2_H : ROW_H));
    const height = sizes.reduce((a, b) => a + b, 0);
    const key = `h:${this.homeInput.value().trim()}`;
    return v_flex().flex_1().min_h(0).w_full().child(head)
      .child(v_flex().id("h-list").flex_1().w_full().min_h(0).py(4).overflow_y_scrollbar().track_scroll(this.homeScroll)
        .on_scroll_wheel((e, cx) => { if (this.homeTab === "projects" && this.wheelNearEnd(key, e, height)) this.loadProjects(cx, true); })
        .children(rows.map((r, n) => div().h(sizes[n]).w_full().flex_none().child(this.homeRow(t, r, r === sel, pick.indexOf(r), n)))));
  }

  homeRow(t, r, on, index, n) {
    const tr = T();
    if (r.kind === "head") return div().px(14).pt(10).pb(3).text_size(11).font_semibold().text_color(t.dim).child(r.text);
    const base = (id) => h_flex().id(id).mx(6).px(8).h_full().gap(10).items_center().rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
      .on_mouse_down("left", stop)
      .on_click((e, cx) => {
        if (on || e.click_count === 2) this.activateHome(r, cx);
        else { this.homeSel = index; cx.notify(); }
      });
    if (r.kind === "tickets") {
      return base("h-tickets")
        .child(svg(`${ICON}/person.svg`).size(15).flex_none().text_color(t.accent))
        .child(div().flex_1().min_w(0).text_size(13).font_semibold().child(tr.tabs.mine))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(String(this.mine.length)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("↵"));
    }
    const p = r.item;
    const where = p.kind === "view" ? (p.team?.key ?? (p.shared ? tr.workspace : tr.personal)) : (p.teams ?? []).join(" ");
    return base(`h-p-${n}`)
      .child(div().id(`h-fav-${n}`).w(18).flex_none().text_color(r.fav ? STAR : t.dim).hover((s) => s.text_color(STAR))
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.toggleFav(p, cx); })
        .child(svg(`${ICON}/${r.fav ? "star-fill" : "star"}.svg`).size(14)))
      .child(div().flex_1().min_w(0).truncate().child(p.name))
      .when(Boolean(where), (el) => el.child(div().flex_none().max_w(140).truncate().text_size(11).text_color(t.dim).child(where)))
      .when(Boolean(p.status), (el) => el.child(div().w(90).flex_none().truncate().text_size(11).text_color(t.muted).child(p.status.name)));
  }

  fillBoard(cx) {
    if ((this.layout === "board" || this.peopleOf().length || this.findInput.value().trim()) && this.mode === "list" && this.hasMore() && this.pickable().length < BOARD_MAX) this.loadMore(cx);
  }

  boardView(t) {
    const cols = this.boardColumns();
    if (!cols.length) return this.listView(t);
    const sel = this.selected();
    const kids = new Map();
    for (const col of cols) for (const x of col.cards) {
      const p = x.r.issue.parent?.identifier;
      if (p) kids.set(p, (kids.get(p) ?? 0) + 1);
    }
    return v_flex().flex_1().min_h(0).w_full()
      .child(h_flex().id("l-board").flex_1().min_h(0).w_full().p(12).gap(12).overflow_x_scrollbar()
        .children(cols.map((col, n) => v_flex().w(BOARD_COL).flex_none().h_full().min_h(0).gap(8)
          .child(h_flex().h(26).px(4).gap(8).items_center().flex_none()
            .child(svg(stateIcon(col.state)).size(14).flex_none().text_color(col.state.color ?? t.dim))
            .child(div().min_w(0).truncate().text_size(12.5).font_semibold().child(col.key))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(col.cards.length))))
          .child(v_flex().id(`bc-${n}`).flex_1().min_h(0).gap(6).overflow_y_scrollbar()
            .children(col.cards.map((x) => this.boardCard(t, x, x.r === sel, kids)))))));
  }

  boardCard(t, x, on, kids) {
    const { r, index } = x, i = r.issue;
    const pr = api.mainPr(i), link = this.links?.[i.identifier];
    const labels = i.labels?.nodes ?? [];
    const who = i.assignee?.displayName ?? i.assignee?.name ?? null;
    const mine = this.assignedToMe(i);
    const children = this.details[i.identifier]?.relations?.children?.length || kids.get(i.identifier) || 0;
    const card = v_flex().id(`bk-${i.identifier}`).relative().p(10).gap(6).rounded(8).border_1()
      .border_color(on ? t.accent : t.border).bg(on ? t.selected : i.parent ? SUB_BG : t.surface).cursor_pointer().hover((s) => s.border_color(t.accent))
      .when(CLOSED.has(i.state?.type), (el) => el.opacity(0.6))
      .on_mouse_down("left", stop).on_click((_e, cx) => { this.sel = index; this.activate(r, cx); })
      .when(mine, (el) => el.child(div().absolute().left(0).top(10).bottom(10).w(3).rounded(2).bg(t.accent)))
      .child(h_flex().gap(6).items_center()
        .child(this.prioIcon(t, i.priority))
        .child(div().id(`bk-id-${i.identifier}`).flex_none().text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.accent))
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.copy(i.identifier, "ID", cx); }).child(i.identifier))
        .child(div().flex_1())
        .when(Boolean(r.pin), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(T().currentBranch)))
        .when(Boolean(pr), (el) => el.child(this.prBadge(t, pr, `bp-${i.identifier}`)))
        .when(Boolean(link), (el) => el.child(this.agentBadge(t, link, `bb-${i.identifier}`, true))))
      .child(div().w_full().text_size(12.5).child(i.title))
      .when(labels.length > 0, (el) => el.child(h_flex().gap(4).flex_wrap().items_center()
        .children(labels.map((l) => h_flex().h(18).px(6).gap(4).items_center().rounded(9).border_1().border_color(t.border).text_size(10.5).text_color(t.muted)
          .child(div().size(6).rounded(3).bg(l.color ?? t.dim)).child(div().child(l.name))))))
      .when(Boolean(who), (el) => el.child(mine ? h_flex().child(this.mineBadge(t, who, true))
        : h_flex().gap(5).items_center().child(this.avatar(t, who, 16)).child(div().text_size(11).text_color(t.dim).child(who))));
    const family = (key, color, label, rest, action) => h_flex().id(`bf-${key}-${i.identifier}`).w_full().h(24).px(8).gap(6).items_center().rounded(6)
      .bg(`${color}1f`).border_1().border_color(`${color}66`).text_size(11)
      .when(Boolean(action), (el) => el.cursor_pointer().hover((st) => st.bg(`${color}33`)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }))
      .child(div().flex_none().font_semibold().text_color(color).child(label))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(rest));
    return card.w_full().flex_none()
      .when(children > 0, (el) => el.child(family("parent", t.accent, T().parentTicket, T().subCount(children))))
      .when(Boolean(i.parent), (el) => el.child(family("child", t.working, T().childOf(i.parent.identifier), i.parent.title ?? "",
        (cx) => this.openDetail(i.parent.identifier, cx, true))));
  }

  rowFacts(r) {
    const i = r.issue;
    const w = this.width;
    const sub = this.nest && r.depth !== undefined && r.depth > 0;
    const labels = i.labels?.nodes ?? [];
    const who = i.assignee?.displayName ?? i.assignee?.name ?? null;
    const parentRef = Boolean(i.parent) && !sub;
    const project = w >= 980 ? i.project?.name ?? null : null;
    return { w, sub, labels, who, parentRef, project, meta: labels.length > 0 || Boolean(who) || parentRef || Boolean(project) };
  }

  rowHeight(r) {
    if (r.kind === "head") return HEAD_H;
    return this.rowFacts(r).meta ? ROW2_H : ROW_H;
  }

  row(t, r, on, index, n) {
    if (r.kind === "head") return div().px(14).pt(10).pb(3).text_size(11).font_semibold().text_color(t.dim).child(r.text);
    const base = (id) => h_flex().id(id).mx(6).px(8).gap(8).rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
      .on_mouse_down("left", stop)
      .on_click((e, cx) => {
        this.focusList();
        if (on || e.click_count === 2) this.activate(r, cx);
        else { this.sel = index; cx.notify(); }
      });
    const i = r.issue;
    const link = this.links?.[i.identifier];
    const pr = api.mainPr(i);
    const { w, sub, labels, who, parentRef, project, meta } = this.rowFacts(r);
    const closed = CLOSED.has(i.state?.type);
    const mine = this.assignedToMe(i);
    const headH = link ? 30 : LINE_H;
    const head = h_flex().h(headH).gap(8).items_center()
      .child(this.prioIcon(t, i.priority))
      .child(div().id(`l-id-${i.identifier}-${n}`).flex_none().text_size(11.5).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.accent)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.copy(i.identifier, "ID", cx); }).child(i.identifier))
      .child(svg(stateIcon(i.state)).size(14).flex_none().text_color(i.state?.color ?? t.dim))
      .child(div().flex_1().min_w(0).truncate().text_color(closed ? t.muted : t.foreground).when(closed, (el) => el.line_through()).child(i.title))
      .when(Boolean(r.progress), (el) => el.child(this.progressPill(t, r, `lpg-${i.identifier}-${n}`)))
      .when(Boolean(r.pin), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(T().currentBranch)))
      .when(Boolean(pr), (el) => el.child(this.prBadge(t, pr, `lp-${i.identifier}-${n}`)))
      .when(Boolean(link), (el) => el.child(this.agentBadge(t, link, `lb-${i.identifier}-${n}`, true)))
      .when(w >= 760, (el) => el.child(div().w(88).flex_none().truncate().text_size(11).text_color(t.muted).child(i.state?.name ?? "")))
      .when(w >= 760, (el) => el.child(div().w(48).flex_none().text_size(11).text_color(t.dim).child(ago(i.updatedAt))));
    const details = h_flex().min_h(META_H).pl(22).gap(6).items_center().min_w(0).flex_wrap()
      .when(parentRef, (el) => el.child(h_flex().flex_none().max_w(220).gap(4).text_size(10.5).text_color(t.dim)
        .child(div().flex_none().child(`↳ ${i.parent.identifier}`))
        .child(div().min_w(0).truncate().text_color(t.muted).child(i.parent.title ?? ""))))
      .when(Boolean(who), (el) => el.child(mine ? this.mineBadge(t, who, false) : h_flex().flex_none().gap(5).items_center()
        .child(this.avatar(t, who, 14))
        .child(div().text_size(11).text_color(t.muted).child(who))))
      .children(labels.map((l) => h_flex().flex_none().h(17).px(6).gap(4).items_center().rounded(9).border_1().border_color(t.border).text_size(10.5).text_color(t.muted)
        .child(div().size(6).rounded(3).bg(l.color ?? t.dim)).child(div().child(l.name))))
      .when(Boolean(project), (el) => el.child(div().flex_none().max_w(160).truncate().text_size(10.5).text_color(t.dim).child(project)));
    return base(`l-${i.identifier}-${n}`).relative().when(meta, (el) => el.min_h(ROW2_H)).when(!meta, (el) => el.h(ROW_H))
      .when(sub && !on, (el) => el.bg(SUB_BG))
      .when(mine, (el) => el.child(div().absolute().left(0).top(7).bottom(7).w(3).rounded(2).bg(t.accent)))
      .when(sub, (el) => el.child(this.treeGuides(t, r.guides, meta ? 2 + headH / 2 : ROW_H / 2)))
      .child((meta ? v_flex().flex_1().min_w(0).py(2).gap(2) : v_flex().flex_1().min_w(0).h_full().gap(2).justify_center()).when(closed, (el) => el.opacity(0.45))
        .child(head)
        .when(meta, (el) => el.child(details)));
  }

  treeGuides(t, guides, elbow) {
    const col = (g, n) => {
      const c = div().relative().w(n === guides.length - 1 ? TREE_STEP - 8 : TREE_STEP).h_full().flex_none();
      const line = (el) => el.child(div().absolute().left(TREE_X).top(0).bottom(0).w(1).bg(t.dim));
      if (g === "line") return line(c);
      if (g === "mid" || g === "end") {
        return (g === "mid" ? line(c) : c).child(div().absolute().left(TREE_X).top(0).h(elbow).w(TREE_STEP - TREE_X - 3)
          .border_l(1).border_b(1).rounded_bl(6).border_color(t.dim));
      }
      return c;
    };
    return h_flex().h_full().flex_none().children(guides.map(col));
  }

  // "1/7" with a ring filled by the share done, beside a parent. Clicking folds or unfolds its sub-issues.
  progressPill(t, r, id) {
    const { done, total } = r.progress;
    const k = total ? Math.round((done / total) * 8) : 0;
    const full = total > 0 && done >= total;
    const ring = div().relative().size(13).flex_none()
      .child(svg(`${ICON}/prog-ring.svg`).absolute().inset_0().size(13).text_color(t.border))
      .when(k > 0, (el) => el.child(svg(`${ICON}/prog-${Math.min(8, k)}.svg`).absolute().inset_0().size(13).text_color(full ? t.done : t.accent)));
    return h_flex().id(id).flex_none().h(20).px(7).gap(5).items_center().rounded(10).border_1().border_color(t.border)
      .text_size(11).text_color(t.muted).cursor_pointer().when(r.folded, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.toggleFold(r.issue.identifier, cx); })
      .child(ring).child(`${done}/${total}`)
      .when(r.folded, (el) => el.child(div().text_size(10).text_color(t.dim).child("▸")));
  }

  prioIcon(t, p) {
    return svg(`${ICON}/${PRIO_ICON[p] ?? "prio-none"}.svg`).size(14).flex_none().text_color(p === 1 ? URGENT : p ? t.muted : t.dim);
  }

  // The issue's main pull request: state icon and number in GitHub's colors, then the review
  // (✓ approved, ± changes requested) and a conflict mark. Clicking opens it. `big` adds the words.
  prBadge(t, pr, id, big = false) {
    const tr = T().pr;
    const color = PR_COLOR[pr.status] ?? t.dim;
    const words = big ? [tr.status[pr.status], pr.review && tr.review[pr.review], pr.conflicts && tr.conflicts].filter(Boolean).join(" · ") : "";
    return h_flex().id(id).flex_none().h(big ? 24 : 20).px(big ? 8 : 5).gap(4).items_center().rounded(5).cursor_pointer()
      .text_size(big ? 12 : 11).text_color(color).hover((s) => s.bg(t.hover))
      .when(big, (el) => el.border_1().border_color(t.border))
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.openUrl(pr.url, cx); })
      .child(svg(`${ICON}/${PR_ICON[pr.status]}.svg`).size(big ? 13 : 12).text_color(color))
      .child(`${big && pr.repo ? `${pr.repo} ` : ""}#${pr.number ?? ""}`)
      .when(Boolean(pr.review), (el) => el.child(div().text_color(REVIEW_COLOR[pr.review]).font_semibold().child(pr.review === "approved" ? "✓" : "±")))
      .when(pr.conflicts, (el) => el.child(div().text_color(t.blocked).child("⚠")))
      .when(Boolean(words), (el) => el.child(div().text_color(t.muted).child(words)));
  }

  // The agent in the issue's tab. Clicking goes to that tab.
  mineBadge(t, who, big) {
    return h_flex().flex_none().h(big ? 26 : 20).pl(3).pr(big ? 9 : 7).gap(6).items_center().rounded(13)
      .bg(`${t.accent}26`).border_1().border_color(t.accent)
      .child(this.avatar(t, who, big ? 20 : 15))
      .child(div().text_size(big ? 12 : 11).font_semibold().text_color(t.accent).child(who));
  }

  agentBadge(t, link, id, big = false) {
    const st = link.tab.status, a = T().agent, prog = link.program;
    const color = st === "working" ? t.working : st === "blocked" ? t.blocked : st === "done" ? t.done : t.dim;
    const label = st === "working" ? elapsed(Date.now() - (link.tab.working_since ?? Date.now()))
      : st === "blocked" ? a.blocked : link.watching ? a.watching[link.watching] : st === "done" ? a.done : a.idle;
    const claude = prog?.key === "claude" || Boolean(link.watching);
    const tint = claude ? CLAUDE : prog?.agent ? prog?.color ?? AGENT_COLOR[prog.key] ?? AGENT_COLOR.other : color;
    const icon = svg(prog?.icon ?? (claude ? CLAUDE_ICON : `${ICON}/terminal.svg`)).size(big ? 22 : 16).flex_none().text_color(tint);
    return h_flex().id(id).flex_none().h(big ? 30 : 22).px(big ? 9 : 6).gap(5).items_center().rounded(5).cursor_pointer()
      .border_1().border_color(st === "working" ? color : t.border)
      .text_size(big ? 12 : 11).text_color(color).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.goTab(link); })
      .child(icon)
      .when(st === "working", (el) => el.child(svg(`${ICON}/spinner.svg`).size(big ? 12 : 10).text_color(color).spin(900)))
      .when(st === "blocked" || (st === "done" && !link.watching), (el) => el.child(div().size(6).rounded(3).bg(color)))
      .child(label);
  }


  // ── Lightbox ──────────────────────────────────────────
  // Every loaded image of the shown issue (description, then comments), so ← → walk through them.

  gallery() {
    const d = this.details[this.shownId()];
    if (!d) return [];
    const mds = [d.issue?.description ?? "", ...(d.comments ?? []).map((c) => c.body ?? "")];
    const urls = mds.flatMap((md) => imageParts(md).map((p) => p.url));
    return [...new Set(urls)].filter((u) => { const i = this.image(u); return i?.state === "ok" && i.w > 0; });
  }

  openLightbox(url, cx) {
    const urls = this.gallery();
    if (!urls.includes(url)) urls.unshift(url);
    this.lightbox = { urls, idx: urls.indexOf(url) };
    this.focusList();
    cx.notify();
  }

  closeLightbox(cx) {
    this.lightbox = null;
    if (this.mode === "list" && !this.pick) this.focusList();
    cx.notify();
  }

  lightboxKey(k, cx) {
    const lb = this.lightbox;
    const n = lb.urls.length;
    const mv = (d) => { lb.idx = (lb.idx + d + n) % n; cx.notify(); };
    const m = {
      escape: () => this.closeLightbox(cx), space: () => this.closeLightbox(cx), q: () => this.closeLightbox(cx), enter: () => this.closeLightbox(cx),
      left: () => mv(-1), right: () => mv(1), h: () => mv(-1), l: () => mv(1), tab: () => mv(1), "shift-tab": () => mv(-1),
      o: () => { const img = this.image(lb.urls[lb.idx]); if (img?.abs) exec("open", [img.abs]); },
    };
    m[k]?.();
  }

  lightboxView(t) {
    const { urls, idx } = this.lightbox;
    const img = this.image(urls[idx]);
    const pad = 28, bar = 34;
    const maxW = Math.max(100, this.width - pad * 2), maxH = Math.max(100, this.height - pad * 2 - bar);
    // Fit the window, enlarging up to 2× (a retina screenshot's own pixels).
    let w = img?.w ? (img.w / 2 > 200 ? img.w / 2 : img.w) : 0;
    let h = img?.w ? (w * img.h) / img.w : 0;
    const s = w && h ? Math.min(2, maxW / w, maxH / h) : 0;
    w = Math.round(w * s); h = Math.round(h * s);
    const nav = (dir, label) => div().id(`lb-${dir}`).size(36).flex_none().flex().items_center().justify_center().rounded(18)
      .bg(t.popover).border_1().border_color(t.border).text_color(t.muted).text_size(16).cursor_pointer()
      .hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => { this.lightboxKey(dir, cx); });
    const many = urls.length > 1;
    return v_flex().id("lightbox").absolute().inset_0().items_center().justify_center().gap(10).bg("#000000e6")
      .on_mouse_down("left", stop).on_scroll_wheel(stop)
      .on_click((_e, cx) => this.closeLightbox(cx))
      .child(h_flex().gap(14).items_center()
        .when(many, (el) => el.child(nav("left").child("‹")))
        .child(img?.state === "ok" && w > 0
          ? div().id("lb-img").w(w).h(h).flex_none().rounded(6).overflow_hidden().on_mouse_down("left", stop).on_click((_e, cx) => cx.stop_propagation())
            .child(image(img.rel).w(w).h(h))
          : div().text_color(t.dim).child(T().imgLoading("")))
        .when(many, (el) => el.child(nav("right").child("›"))))
      .child(h_flex().h(bar - 10).px(12).gap(10).items_center().rounded(12).bg("#00000099").text_size(11.5).text_color("#ffffffc0")
        .when(many, (el) => el.child(div().child(`${idx + 1} / ${urls.length}`)))
        .child(div().child(T().lightboxHint)));
  }

  // Markdown in text and image pieces. Images are downloaded once and fitted to the width.
  markdown(t, key, md, maxW) {
    const parts = splitMarkdown(md);
    return v_flex().gap(8).w_full().children(parts.map((part, n) => {
      if (part.kind === "table") return this.table(t, `${key}-t${n}`, part, maxW);
      if (part.kind === "text") {
        return TextView.markdown(`${key}-${n}`, part.text).selectable().on_link_click((url, cx) => { this.linkAt = Date.now(); this.openUrl(url, cx); });
      }
      const img = this.image(part.url);
      // An upload link whose file isn't an image (a PDF, a video): the link it was.
      if (part.link && img?.state === "error" && /type/.test(img.why ?? "")) {
        return TextView.markdown(`${key}-${n}`, part.src).selectable().on_link_click((url, cx) => { this.linkAt = Date.now(); this.openUrl(url, cx); });
      }
      if (img?.state === "ok" && img.w > 0) {
        // Retina screenshots show at half their pixel size. Fit the width and at most 520 px of height.
        let w = Math.min(img.w / 2 > 200 ? img.w / 2 : img.w, maxW);
        let h = (w * img.h) / img.w;
        if (h > 520) { w = (w * 520) / h; h = 520; }
        w = Math.round(w); h = Math.round(h);
        const pic = div().id(`${key}-img-${n}`).w(w).h(h).flex_none().rounded(6).overflow_hidden().border_1().border_color(t.border).cursor_pointer()
          .on_mouse_down("left", stop).on_click((_e, cx) => this.openLightbox(part.url, cx))
          .child(image(img.rel).w(w).h(h));
        // A link's text is the screenshot's caption.
        return part.link && part.alt.trim()
          ? v_flex().gap(4).child(div().text_size(11.5).text_color(t.muted).child(part.alt)).child(pic)
          : pic;
      }
      const failed = img?.state === "error";
      return h_flex().id(`${key}-img-${n}`).h(44).px(12).gap(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.surface)
        .text_size(11.5).text_color(failed ? t.muted : t.dim).cursor_pointer().on_mouse_down("left", stop)
        .on_click((_e, cx) => this.openUrl(part.url, cx))
        .child(failed ? T().imgFailed(part.alt) : T().imgLoading(part.alt));
    }));
  }

  // A markdown table: bordered grid, header on `surface`, each cell markdown of its own (images
  // fitted to the column). Columns share the width evenly; a wide table scrolls sideways.
  table(t, key, tb, maxW) {
    const n = tb.head.length;
    const colW = Math.max(120, Math.floor((maxW - 2) / n));
    const cell = (md, r, c, head) => {
      const al = tb.align[c];
      return v_flex().w(colW).flex_none().min_w(0).px(10).py(7).gap(6).text_size(12.5)
        .when(c > 0, (el) => el.border_l(1).border_color(t.border))
        .when(al === "center", (el) => el.items_center()).when(al === "right", (el) => el.items_end())
        .when(head, (el) => el.font_semibold())
        .when(Boolean(md.trim()), (el) => el.child(this.inline(t, `${key}-${r}-${c}`, md, colW - 22)));
    };
    const row = (cells, r, head) => h_flex().items_start().flex_none()
      .when(r > 0, (el) => el.border_t(1).border_color(t.border)).when(head, (el) => el.bg(t.surface))
      .children(cells.map((md, c) => cell(md, r, c, head)));
    const grid = v_flex().flex_none().child(row(tb.head, 0, true)).children(tb.rows.map((r, k) => row(r, k + 1, false)));
    return div().id(key).w_full().rounded(6).border_1().border_color(t.border).overflow_x_scrollbar().child(grid);
  }

  // A table cell: its text and images (no tables inside).
  inline(t, key, md, maxW) {
    const parts = splitImages(md.replace(/<br\s*\/?>/gi, "\n"));
    return v_flex().gap(6).w_full().children(parts.map((part, n) => part.kind === "text"
      ? TextView.markdown(`${key}-${n}`, part.text).selectable().on_link_click((url, cx) => this.openUrl(url, cx))
      : this.markdown(t, `${key}-${n}`, part.src ?? `![${part.alt}](${part.url})`, maxW)));
  }

  empty(t, text) {
    return v_flex().flex_1().items_center().justify_center().text_color(t.dim).text_size(12.5).child(text);
  }

  chip(t, color, text) {
    return h_flex().h(22).px(8).gap(6).items_center().rounded(11).border_1().border_color(t.border).text_size(11.5)
      .child(div().size(7).rounded(4).bg(color ?? t.dim)).child(text);
  }

  button(t, id, label, action, primary = false) {
    return h_flex().id(id).h(26).px(10).items_center().rounded(6).text_size(12)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .border_1().border_color(primary ? t.solid : t.border).hover((s) => s.opacity(0.85))
      .on_mouse_down("left", stop).on_click((_e, cx) => action(cx)).child(label);
  }

  // A small text button on a comment's header line.
  miniButton(t, id, label, action, on = false) {
    return h_flex().id(id).h(22).px(7).items_center().rounded(6).text_size(11.5).flex_none()
      .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.hover))
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => action(cx)).child(label);
  }

  // Reaction pills, mine outlined.
  reactionsBar(t, data, key) {
    const groups = Doc.reactionGroups(data, this.viewer?.id);
    if (!groups.length) return null;
    const pill = (name, count, mine, pid) => h_flex().id(pid).h(24).px(8).gap(5).items_center().rounded(12).border_1().flex_none()
      .border_color(mine ? t.accent : t.border).bg(mine ? `${t.accent}26` : t.raised)
      .child(div().text_size(13).child(Doc.emoji(name)))
      .when(count > 0, (el) => el.child(div().text_size(11.5).text_color(mine ? t.foreground : t.muted).child(String(count))));
    return h_flex().gap(6).flex_wrap().items_center()
      .children(groups.map((g) => pill(g.emoji, g.count, Boolean(g.mine), `${key}-r-${g.emoji}`)));
  }

  overviewView(t, v) {
    const tr = T(), p = this.overviews[v.id];
    if (!p) return this.empty(t, this.loading.has(`po:${v.id}`) ? tr.loading : tr.projectNoOverview);
    const people = Object.fromEntries((this.people ?? []).map((x) => [x.id, x.name]));
    const events = projectEvents(p, people);
    const maxW = Math.max(320, (this.width || 900) - 80);
    const HEALTH = { onTrack: ["On track", t.done], atRisk: ["At risk", "#f08c00"], offTrack: ["Off track", t.blocked] };
    const fact = (label, value) => (value ? h_flex().gap(6).items_center().text_size(12)
      .child(div().text_color(t.dim).child(label)).child(div().text_color(t.foreground).child(value)) : null);
    const pct = Math.round((p.progress ?? 0) * 100);
    const card = (key, who, at, chip, body) => v_flex().w_full().gap(6).p(12).rounded(8).border_1().border_color(t.border).bg(t.surface)
      .child(h_flex().gap(8).items_center().text_size(12)
        .child(this.avatar(t, who, 18)).child(div().font_semibold().child(who)).child(div().text_color(t.dim).child(ago(at)))
        .child(chip))
      .child(this.markdown(t, key, body || "_Empty_", maxW - 40));
    return v_flex().id(`po-${v.id}`).flex_1().min_h(0).w_full().px(20).py(16).gap(18).overflow_y_scrollbar()
      .child(v_flex().gap(10)
        .child(h_flex().gap(10).items_center().flex_wrap()
          .child(div().size(10).flex_none().rounded(5).bg(p.status?.color ?? v.color ?? t.dim))
          .child(div().text_size(18).font_semibold().child(p.name))
          .when(Boolean(p.status?.name), (el) => el.child(this.chip(t, p.status.color, p.status.name)))
          .when(Boolean(HEALTH[p.health]), (el) => el.child(this.chip(t, HEALTH[p.health][1], HEALTH[p.health][0])))
          .child(div().flex_1())
          .child(this.button(t, "po-open", tr.projectOpen, (cx) => this.openUrl(p.url, cx))))
        .child(h_flex().gap(16).items_center().flex_wrap()
          .when(p.progress != null, (el) => el.child(h_flex().gap(8).items_center()
            .child(div().w(120).h(6).rounded(3).bg(t.border).child(div().h_full().rounded(3).bg(t.done).w(Math.max(2, Math.round(1.2 * pct)))))
            .child(div().text_size(12).text_color(t.muted).child(`${pct}%`))))
          .children([fact(tr.projectLead, p.lead?.name), fact(tr.projectTeams, (p.teams?.nodes ?? []).map((x) => x.key).join(", ")),
            fact(tr.projectStart, p.startDate), fact(tr.projectTarget, p.targetDate)].filter(Boolean))))
      .child(v_flex().gap(8)
        .child(div().text_size(11).font_semibold().text_color(t.dim).child(tr.projectDescription))
        .child(this.markdown(t, `po-desc-${v.id}`, p.content || p.description || `_${tr.projectNoDescription}_`, maxW)))
      .when((p.projectMilestones?.nodes ?? []).length > 0, (el) => el.child(v_flex().gap(4)
        .child(div().text_size(11).font_semibold().text_color(t.dim).child(tr.projectMilestones))
        .children(p.projectMilestones.nodes.map((m) => h_flex().gap(8).items_center().text_size(12.5)
          .child(div().text_color(t.dim).child("◆")).child(div().child(m.name || "—"))
          .when(Boolean(m.targetDate), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(m.targetDate)))))))
      .child(v_flex().gap(8)
        .child(div().text_size(11).font_semibold().text_color(t.dim).child(`${tr.projectActivity}  ${events.length}`))
        .when(!events.length, (el) => el.child(div().text_size(12).text_color(t.dim).child(tr.projectNoActivity)))
        .children(events.map((e, n) => (e.kind === "event"
          ? h_flex().gap(8).items_center().text_size(12).text_color(t.muted)
            .child(div().w(18).flex_none().text_color(t.dim).child("•"))
            .child(div().flex_none().font_semibold().text_color(t.foreground).child(e.who)).child(div().min_w(0).child(e.text))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(e.at)))
          : card(`po-${e.kind}-${n}`, e.who, e.at,
            e.kind === "update" && HEALTH[e.health] ? this.chip(t, HEALTH[e.health][1], `${tr.projectUpdate} · ${HEALTH[e.health][0]}`)
              : this.chip(t, t.dim, e.kind === "update" ? tr.projectUpdate : tr.projectComment), e.body)))));
  }


  avatar(t, name, size = 20) {
    return h_flex().size(size).flex_none().rounded(size / 2).bg(t.raised).items_center().justify_center()
      .text_size(size * 0.52).font_semibold().text_color(t.muted).child([...(name || "?")][0].toUpperCase());
  }

  commentView(t, id, c, maxW, reply) {
    const tr = T();
    const name = c.user?.displayName ?? c.user?.name ?? tr.unknownUser;
    const rkey = `c-${c.id}`;
    const bar = this.reactionsBar(t, c.reactionData, rkey);
    return v_flex().gap(6).min_w(0)
      .child(h_flex().gap(8).items_center().text_size(11.5)
        .child(this.avatar(t, name, reply ? 18 : 20))
        .child(div().font_semibold().flex_none().child(name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(ago(c.createdAt) + (c.editedAt ? tr.edited : "")))
        .when(this.canWrite && !reply, (el) => el.child(this.miniButton(t, `${rkey}-reply`, tr.reply, (cx) => this.openComposer(id, cx, { mode: "reply", parentId: c.id, who: name }))))
        .when(this.canWrite && Boolean(this.viewer?.id) && c.user?.id === this.viewer.id, (el) => el.child(this.miniButton(t, `${rkey}-edit`, tr.edit, (cx) => this.openComposer(id, cx, { mode: "edit", commentId: c.id, body: c.body ?? "" }))))
        .child(this.miniButton(t, `${rkey}-copy`, tr.copyShort, (cx) => this.copy(c.body ?? "", tr.commentWord, cx))))
      .child(this.markdown(t, rkey, c.body ?? "", maxW))
      .when(Boolean(bar), (el) => el.child(bar));
  }

  // A comment and its replies in one card; the replies hang off a line on the left.
  threadView(t, id, th, maxW) {
    return v_flex().gap(12).p(12).rounded(8).bg(t.surface).border_1().border_color(t.border).min_w(0)
      .child(this.commentView(t, id, th.comment, maxW - 26, false))
      .when(th.replies.length > 0, (el) => el.child(v_flex().gap(12).ml(9).pl(14).border_l(2).border_color(t.border)
        .children(th.replies.map((r) => this.commentView(t, id, r, maxW - 26 - 25, true)))));
  }

  // The outline on the right, a map of the page: the description's headings, then each comment
  // thread. The item at the top of the view is marked, the ones on screen are brighter, and it keeps
  // the marked one in sight as the page scrolls. A click scrolls the page there.
  detailView(t, id) {
    const tr = T();
    const d = this.details[id];
    const issue = d?.issue ?? this.cache[id];
    if (!issue) return this.empty(t, this.loading.has(`d:${id}`) ? tr.loading : `${id}`);
    const hist = { ...tr.hist, priorityName: { 0: tr.noPriority, ...tr.priority } };
    const entries = d ? historyEntries(d.issue, d.history, hist) : [];
    const rel = d?.relations;
    const secs = Doc.sections(issue.description ?? "");
    const thr = d ? Doc.threads(d.comments) : null;
    const editing = this.issueEdit?.id === id;
    const narrow = this.width < NARROW;
    const maxW = Math.max(160, this.width - 40 - (narrow ? 0 : SIDEBAR_W));
    const relRow = (x, n, kind) => h_flex().id(`rel-${kind}-${x.id}-${n}`).h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.openDetail(x.identifier, cx, false))
      .when(CLOSED.has(x.state?.type), (el) => el.opacity(0.5))
      .child(svg(stateIcon(x.state)).size(13).flex_none().text_color(x.state?.color ?? t.dim))
      .child(div().w(64).flex_none().text_size(11.5).text_color(t.dim).child(x.identifier))
      .child(div().flex_1().min_w(0).truncate().child(x.title))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(x.state?.name ?? ""))
      .when(Boolean(this.links?.[x.identifier]), (el) => el.child(this.agentBadge(t, this.links[x.identifier], `rb-${kind}-${x.id}-${n}`)));
    const relGroup = (title, list, kind, color) => list?.length
      ? v_flex().gap(1).child(div().text_size(11).font_semibold().text_color(color ?? t.dim).child(`${title} ${list.length}`)).children(list.map((x, n) => relRow(x, n, kind)))
      : null;
    const groups = [
      issue.parent && relGroup(tr.rel.parent, [issue.parent], "parent"),
      rel && relGroup(rel.moreChildren ? tr.rel.childrenSome : tr.rel.children, rel.children, "child"),
      rel && relGroup(tr.rel.blockedBy, rel.blockedBy, "blockedby", t.blocked),
      rel && relGroup(tr.rel.blocking, rel.blocking, "blocking"),
      rel && relGroup(tr.rel.related, rel.related, "related"),
    ].filter(Boolean);

    const titleRow = () => h_flex().gap(10).items_center()
      .child(this.button(t, "d-back", tr.back, (cx) => this.back(cx)))
      .child(div().id("d-ident").flex_none().text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.copy(issue.identifier, "ID", cx)).child(issue.identifier))
      .child(div().flex_1().min_w(0).child(editing && this.issueEdit.field === "title"
        ? h_flex().id(`e-title-${id}`).h(38).px(8).items_center().rounded(6).border_1().bg(t.background)
          .border_color(t.accent).on_mouse_down("left", stop)
          .child(Input.new(this.titleInput).flex_1().h_full().text_size(17).font_semibold())
        : this.editable(t, `d-title-wrap-${id}`, id, "title",
          TextView.markdown(`d-title-${id}`, `## ${issue.title.replace(/[\\`*_[\]#]/g, "\\$&")}`).selectable())));

    const divider = (label) => h_flex().gap(10).items_center().pt(6).text_size(11.5).font_semibold().text_color(t.dim)
      .child(div().child(label)).child(div().flex_1().h(1).bg(t.border));

    const items = [{ key: "top", el: () => v_flex().gap(14).child(titleRow()).when(narrow, (el) => el.child(this.sidebarView(t, issue, id, true))) }];
    const bodyEdit = editing && this.issueEdit.field === "body";
    if (bodyEdit) items.push({ key: "edit", el: () => this.issueEditor(t, id) });
    else if (!secs.length) items.push({ key: "nobody", el: () => this.editable(t, `d-nobody-${id}`, id, "body",
      div().py(4).text_size(12.5).text_color(t.dim).child(this.canWrite ? tr.addBody : tr.noBody)) });
    else for (const s of secs) items.push({ key: s.key, el: () => this.editable(t, `d-bwrap-${id}-${s.key}`, id, "body", this.markdown(t, `d-body-${id}-${s.key}`, s.text, maxW)) });
    if (d) {
      const bar = this.reactionsBar(t, d.issue.reactionData, "issue");
      if (bar) items.push({ key: "ireact", el: () => bar });
    }
    if (groups.length) items.push({ key: "rels", el: () => v_flex().gap(10).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border).children(groups) });
    if (entries.length) {
      items.push({ key: "hist", el: () => v_flex().gap(6).child(divider(`${tr.activity} ${entries.length}`))
        .children(entries.map((x) => h_flex().gap(8).items_start().text_size(12)
          .child(div().w(72).flex_none().text_size(11.5).text_color(t.dim).child(ago(x.at)))
          .child(div().flex_none().font_semibold().child(x.who))
          .child(div().flex_1().min_w(0).text_color(t.muted).child(x.text)))) });
    }
    if (!d) items.push({ key: "cloading", el: () => div().text_size(12).text_color(t.dim).child(tr.commentsLoading) });
    else {
      const n = `${d.comments.length}${d.moreComments ? "+" : ""}`;
      items.push({ key: "cmts", el: () => v_flex().gap(10).child(divider(tr.comments(n)))
        .when(!thr.length, (el) => el.child(div().text_size(12).text_color(t.dim).child(tr.noComments))) });
      for (const th of thr) items.push({ key: `c:${th.comment.id}`, el: () => this.threadView(t, id, th, maxW) });
      if (d.moreComments) items.push({ key: "cmore", el: () => div().text_size(11.5).text_color(t.dim).child(tr.moreComments) });
    }

    const S = this.scrollOf(id);
    const GAP = 14, PAD = 16;
    let y = PAD;
    for (const i of items) { S.tops[i.key] = y; y += (S.h[i.key] ?? 0) + GAP; }
    S.y = Math.max(0, Math.min(this.maxScroll(S), S.y));
    S.keys = ["top", ...secs.filter((s) => s.title).map((s) => s.key), ...(thr ? ["cmts", ...thr.map((x) => `c:${x.comment.id}`)] : [])];
    S.active = S.keys.reduce((a, k) => ((S.tops[k] ?? Infinity) <= S.y + 24 ? k : a), "top");

    const thumb = S.content > S.view && S.view > 0
      ? (() => {
        const h = Math.max(24, (S.view * S.view) / S.content);
        const top = (S.y / Math.max(1, this.maxScroll(S))) * (S.view - h);
        return div().absolute().top(top).right(2).w(5).h(h).rounded(3).bg(t.border);
      })()
      : null;
    const page = v_flex().id(`d-view-${id}`).relative().flex_1().min_w(0).h_full().min_h(0).overflow_hidden()
      .on_size_change((size, cx) => { if (Math.abs(size.height - S.view) > 0.5) { S.view = size.height; cx.notify(); } })
      .on_scroll_wheel((e, cx) => this.scrollBy(id, -e.delta.y, cx))
      .child(v_flex().id(`d-content-${id}`).flex_none().w_full().mt(-S.y).gap(GAP).p(PAD).pb(40)
        .on_size_change((size, cx) => { if (Math.abs(size.height - S.content) > 0.5) { S.content = size.height; cx.notify(); } })
        .children(items.map((i) => v_flex().id(`d-item-${i.key}`).flex_none().w_full()
          .on_size_change((size, cx) => { if (this.measured(S.h, i.key, size.height)) cx.notify(); })
          .child(i.el()))))
      .when(Boolean(thumb), (el) => el.child(thumb));
    return v_flex().flex_1().w_full().min_h(0)
      .on_mouse_down("left", (_e, cx) => { this.hold(cx); if (this.actionsOpen) { this.actionsOpen = false; cx.notify(); } cx.stop_propagation(); })
      .child(h_flex().flex_1().w_full().min_h(0).items_start()
        .child(page)
        .when(!narrow, (el) => el.child(this.sidebarView(t, issue, id, false))))
      .child(this.canWrite ? this.composerBar(t, issue, id) : this.commentBar(t, issue));
  }

  sidebarView(t, issue, id, inline) {
    const tr = T();
    const d = this.details[id];
    const pr = api.mainPr(issue);
    const link = this.links?.[issue.identifier];
    const author = d ? createdBy(d.issue, d.history) : null;
    const title = (text) => div().text_size(11).font_semibold().text_color(t.dim).child(text);
    const prop = (key, label, value, action) => h_flex().id(`sp-${key}`).h(28).px(6).gap(8).items_center().rounded(6)
      .when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => action(cx)))
      .child(div().w(76).flex_none().text_size(11.5).text_color(t.dim).child(label))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_size(12).child(value));
    const text = (s, dim = false) => div().min_w(0).truncate().text_color(dim ? t.dim : t.foreground).child(s);
    const write = (fn) => (this.canWrite ? fn : null);
    const who = issue.assignee?.displayName ?? issue.assignee?.name;
    const cycle = issue.cycle && (this.teamCycles[issue.team?.id] ?? []).find((c) => c.id === issue.cycle.id);
    const picking = (kind) => this.propPick?.id === id && this.propPick.kind === kind && this.propPicker(t);
    // A section title that opens its picker, like Linear's.
    const editTitle = (key, text, kind) => h_flex().id(`sp-t-${key}`).h(22).px(6).gap(6).items_center().rounded(6)
      .when(this.canWrite, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => this.openProp(id, kind, cx)))
      .child(div().flex_1().child(title(text)))
      .when(this.canWrite, (el) => el.child(div().text_size(13).text_color(t.dim).child("+")));
    const facts = [
      prop("state", tr.statusLabel, h_flex().gap(6).items_center().child(svg(stateIcon(issue.state)).size(13).text_color(issue.state?.color ?? t.dim)).child(text(issue.state?.name ?? "?")),
        write((cx) => (this.statePick?.id === id ? (this.statePick = null, cx.notify()) : this.openStates(id, cx)))),
      this.statePick?.id === id && this.statePicker(t),
      prop("assignee", tr.assignee, h_flex().gap(6).items_center()
        .child(issue.assignee ? this.avatar(t, issue.assignee.name, 16) : svg(`${ICON}/person.svg`).size(13).text_color(t.dim))
        .child(div().min_w(0).truncate().text_color(issue.assignee ? (this.assignedToMe(issue) ? t.accent : t.foreground) : t.dim).child(who ?? tr.unassigned)),
        write((cx) => this.openAssign(id, cx))),
      this.assignPick?.id === id && this.assignPicker(t),
      prop("prio", tr.priorityLabel, tr.priority[issue.priority]
        ? h_flex().gap(6).items_center().text_color(issue.priority === 1 ? URGENT : t.foreground).child(this.prioIcon(t, issue.priority)).child(tr.priority[issue.priority])
        : h_flex().gap(6).items_center().child(this.prioIcon(t, 0)).child(text(tr.noPriority, true)),
        write((cx) => this.openProp(id, "priority", cx))),
      picking("priority"),
      issue.team && prop("team", tr.teamLabel, text(issue.team.name)),
      prop("cycle", tr.cycle, issue.cycle ? text(cycle ? cycleName(cycle, tr) : "…") : text(tr.noCycle, true),
        write((cx) => this.openProp(id, "cycle", cx))),
      picking("cycle"),
      prop("due", tr.due, issue.dueDate ? text(issue.dueDate) : text(tr.noDue, true), write((cx) => this.openProp(id, "due", cx))),
      picking("due"),
      issue.createdAt && prop("created", tr.createdLabel, text(author ? `${ago(issue.createdAt)} · ${author}` : ago(issue.createdAt))),
      issue.updatedAt && prop("updated", tr.updated, text(ago(issue.updatedAt))),
    ].filter(Boolean);
    const labels = issue.labels?.nodes ?? [];
    // Every control here has the same look and height.
    const H = 28;
    const btn = (bid, label, action) => this.button(t, bid, label, action).h(H).flex_none();
    const actions = v_flex().gap(8)
      .child(h_flex().gap(6).items_center().flex_wrap()
        .child(btn("d-open", tr.openInLinear, (cx) => this.openUrl(issue.url, cx)))
        .child(btn("d-actions", `${tr.actions}  ▾`, (cx) => { this.actionsOpen = !this.actionsOpen; cx.notify(); })))
      .when(this.actionsOpen, (el) => el.child(v_flex().id("d-actions-menu").p(4).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .child(this.menuRow(t, "d-act-worktree", false, (cx) => { this.actionsOpen = false; this.openStart(issue, cx); })
          .child(div().flex_1().child(tr.startWorktree)))))
      // The agent: one wide button (status, then where it runs) that goes to its tab; its branch below.
      .when(Boolean(link), (el) => el.child(v_flex().gap(6)
        .child(this.agentBadge(t, link, `db-${id}`, true).flex_1().w_full().h(36).px(10).gap(7).text_size(13).bg(t.raised)
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(tr.tabIn(link.space.name, link.tab.name))))
        .when(Boolean(link.branch), (el) => el.child(h_flex().px(2).gap(6).items_center().text_size(11.5).text_color(t.muted)
          .child(svg(`${ICON}/branch.svg`).size(13).flex_none().text_color(t.dim))
          .child(div().min_w(0).truncate().child(link.branch))))))
      .when(Boolean(pr), (el) => el.child(h_flex().pt(10).child(this.prBadge(t, pr, "d-pr", true).h(H))))
      .when(!this.canWrite, (el) => el.child(h_flex().child(btn("d-connect", this.connecting ? tr.connecting : tr.connectLinear, (cx) => this.connect(cx)))));
    const body = v_flex().gap(16).w_full()
      .child(actions)
      .child(v_flex().gap(4).child(title(tr.properties)).children(facts))
      .child(v_flex().gap(6).child(editTitle("labels", tr.labelsTitle, "labels"))
        .child(div().px(6).child(labels.length
          ? h_flex().gap(6).flex_wrap().items_center().children(labels.map((l) => this.chip(t, l.color, l.name)))
          : div().text_size(12).text_color(t.dim).child(tr.noLabels)))
        .when(Boolean(picking("labels")), (el) => el.child(picking("labels"))))
      .child(v_flex().gap(6).child(editTitle("project", tr.projectTitle, "project"))
        .child(div().px(6).text_size(12).text_color(issue.project ? t.foreground : t.dim).child(issue.project?.name ?? tr.noProject))
        .when(Boolean(picking("project")), (el) => el.child(picking("project"))));
    if (inline) return body.p(12).rounded(8).border_1().border_color(t.border);
    return v_flex().id(`d-side-${id}`).w(SIDEBAR_W).flex_none().h_full().min_h(0).overflow_y_scrollbar().p(16).border_l(1).border_color(t.border)
      .child(body);
  }

  issueEditor(t, id) {
    const tr = T();
    return v_flex().gap(4).w_full()
      .child(div().id(`e-body-${id}`).w_full().min_w(0).rounded(6).border_1().bg(t.background).border_color(t.accent)
        .on_mouse_down("left", stop).child(Textarea.new(this.bodyDraft).w_full()))
      .child(div().text_size(11).text_color(t.dim).child(this.issueEdit?.saving ? tr.saving : tr.editHint));
  }

  // Click to edit the title or the description. A link or an image in it keeps its own click.
  editable(t, key, id, field, el) {
    if (!this.canWrite) return el;
    return div().id(key).w_full().min_w(0).cursor_text()
      .on_click((_e, cx) => cx.timer.after(0, (cx) => { if (Date.now() - (this.linkAt ?? 0) > 400) this.editIssue(id, cx, field); }))
      .child(el);
  }

  assignPicker(t) {
    const tr = T(), list = this.assignChoices(), sel = Math.min(this.assignPick.sel, list.length - 1);
    return v_flex().gap(1).p(6).w(340).max_w_full().rounded(8).border_1().border_color(t.border).bg(t.surface)
      .child(h_flex().h(30).px(8).mb(2).gap(6).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background)
        .child(svg(`${ICON}/search.svg`).size(12).text_color(t.dim))
        .child(Input.new(this.assignInput).flex_1().h_full().text_size(12.5)))
      .children(list.map((row, n) => {
        const r = this.menuRow(t, `as-${row.kind === "none" ? "none" : row.person.id}`, n === sel, (cx) => this.pickAssignee(row, cx));
        if (row.kind === "none") return r.child(svg(`${ICON}/person.svg`).size(14).flex_none().text_color(t.dim)).child(div().flex_1().text_color(t.muted).child(tr.unassign));
        const me = row.person.id === this.viewer?.id;
        return r.child(this.avatar(t, row.person.name, 18))
          .child(div().flex_1().min_w(0).truncate().text_color(me ? t.accent : t.foreground).child(me ? `${row.person.name} (${tr.you})` : row.person.name))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(`@${row.person.displayName}`));
      }))
      .when(list.length === 0, (el) => el.child(div().px(8).py(4).text_size(12).text_color(t.dim).child(tr.nobody)))
      .child(div().px(8).pt(4).text_size(11).text_color(t.dim).child(tr.assignHint));
  }

  propPicker(t) {
    const tr = T(), p = this.propPick, list = this.propChoices(), sel = Math.min(p.sel, list.length - 1);
    const multi = p.kind === "labels";
    const hint = p.kind === "due" ? tr.dueHint : multi ? tr.labelsHint : tr.pickHint;
    return v_flex().gap(1).p(6).w(320).max_w_full().rounded(8).border_1().border_color(t.border).bg(t.surface)
      .child(h_flex().h(30).px(8).mb(2).gap(6).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background)
        .child(svg(`${ICON}/search.svg`).size(12).text_color(t.dim))
        .child(Input.new(this.propInput).flex_1().h_full().text_size(12.5)))
      .when(p.items === null, (el) => el.child(div().px(8).py(4).text_size(12).text_color(t.dim).child(tr.loading)))
      .children(list.map((row, n) => this.menuRow(t, `pp-${p.kind}-${row.key}`, n === sel, (cx) => this.pickProp(row, cx))
        .when(multi, (el) => el.child(h_flex().size(14).flex_none().rounded(3).border_1().border_color(row.on ? t.accent : t.border)
          .when(row.on, (el) => el.bg(t.accent).text_size(10).text_color(t.solid_foreground).items_center().justify_center().child("✓"))))
        .when(p.kind === "priority", (el) => el.child(this.prioIcon(t, row.prio)))
        .when(Boolean(row.color) && p.kind !== "priority", (el) => el.child(div().size(8).flex_none().rounded(4).bg(row.color)))
        .child(div().flex_1().min_w(0).truncate().text_color(row.none ? t.muted : t.foreground).child(row.label))
        .when(Boolean(row.on) && !multi, (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("✓")))))
      .when(p.items !== null && list.length === 0, (el) => el.child(div().px(8).py(4).text_size(12).text_color(t.dim).child(p.kind === "due" ? tr.dueBad : tr.nothing)))
      .child(div().px(8).pt(4).text_size(11).text_color(t.dim).child(hint));
  }

  statePicker(t) {
    const tr = T(), p = this.statePick;
    if (!p.states) return div().p(8).text_size(12).text_color(t.dim).child(tr.loading);
    return v_flex().gap(1).p(6).w(320).max_w_full().rounded(8).border_1().border_color(t.border).bg(t.surface)
      .children(p.states.map((st, n) => this.menuRow(t, `st-${st.id}`, n === p.sel, (cx) => this.pickState(st, cx))
        .child(div().w(14).flex_none().text_size(11).text_color(t.dim).child(n < 9 ? String(n + 1) : ""))
        .child(svg(stateIcon(st)).size(13).flex_none().text_color(st.color ?? t.dim))
        .child(div().flex_1().min_w(0).truncate().child(st.name))))
      .child(div().px(8).pt(4).text_size(11).text_color(t.dim).child(tr.stateHint));
  }

  composerBar(t, issue, id) {
    const tr = T();
    const bar = h_flex().flex_none().px(16).py(10).border_t(1).border_color(t.border).bg(t.popover);
    if (this.draftFor !== id) {
      return bar.child(h_flex().id(`c-new-${id}`).flex_1().h(34).px(12).items_center().rounded(8).border_1().border_color(t.border)
        .text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.muted))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.openComposer(id, cx))
        .child(div().flex_1().child(tr.commentPrompt)).child(div().text_size(11).child("m")));
    }
    const m = this.draftMode;
    const empty = !this.draft.value().trim();
    return v_flex().flex_none().gap(8).px(16).py(10).border_t(1).border_color(t.border).bg(t.popover)
      .child(div().text_size(11.5).font_semibold().text_color(m.mode === "new" ? t.muted : t.accent)
        .child(m.mode === "reply" ? tr.replyTo(m.who ?? "") : m.mode === "edit" ? tr.editing : tr.newComment))
      .when(this.mentionChoices().length > 0, (el) => el.child(this.mentionList(t)))
      .child(div().id(`c-draft-${id}`).w_full().min_w(0).rounded(8).border_1().border_color(this.composing ? t.accent : t.border).bg(t.background)
        .on_mouse_down("left", stop).child(Textarea.new(this.draft).w_full()))
      .child(h_flex().gap(8).items_center().justify_end()
        .child(this.button(t, "c-cancel", tr.cancel, (cx) => { this.draftText = ""; this.mention = null; this.draft.set_value(""); this.draftFor = null; this.draftMode = { mode: "new" }; this.closeComposer(cx); }))
        .child(this.button(t, "c-send", this.sending ? tr.saving : m.mode === "edit" ? tr.save : tr.commentSend, (cx) => this.sendComment(cx), !empty && !this.sending)));
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
      .child(div().px(8).pt(2).text_size(10.5).text_color(t.dim).child(T().mentionHint));
  }

  commentBar(t, issue) {
    return h_flex().flex_none().px(16).py(10).border_t(1).border_color(t.border).bg(t.popover)
      .child(h_flex().id(`c-linear-${issue.identifier}`).flex_1().h(34).px(12).items_center().rounded(8).border_1().border_color(t.border)
        .text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.muted))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.openUrl(issue.url, cx))
        .child(div().flex_1().child(T().commentInLinear)).child(div().text_size(11).child("o ↗")));
  }

  footer(t) {
    const s = this.flash ?? this.status;
    return h_flex().h(26).flex_none().px(12).gap(10).items_center().border_t(1).border_color(t.border).text_size(11)
      .child(div().flex_1().min_w(0).truncate().text_color(s ? (s.level === "error" ? t.blocked : s.level === "success" ? t.done : t.muted) : t.dim).child(s?.text ?? ""))
      .when(s?.kind === "auth", (el) => el.child(this.button(t, "f-connect", this.connecting ? T().connecting : T().connectLinear, (cx) => this.connect(cx), true).h(20).px(8).text_size(11)))
      .when(s?.level === "error" && this.errors.length > 0, (el) => el.child(this.button(t, "f-copy-error", T().copyError,
        (cx) => { cx.write_to_clipboard(this.errorReport()); this.say(T().errorCopied, cx, "success"); }).h(20).px(8).text_size(11)))
      .child(div().flex_none().text_color(t.dim).child(this.viewer ? `${this.viewer.displayName ?? this.viewer.name} · ${T().teams} ${(this.viewer.teams?.nodes ?? []).map((x) => x.key).join(" ")}` : ""))
      .child(div().id("shortcuts-hint").px(6).rounded(4).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => { this.shortcuts = !this.shortcuts; cx.notify(); }).child(T().shortcutsHint));
  }

  pickView(t) {
    const tr = T(), issue = this.pick.issue, list = this.choices();
    const sel = Math.min(this.pick.sel, Math.max(0, list.length - 1));
    const tilde = (p) => (p || "~").replace(home(), "~").replace(/^\/(Users|home)\/[^/]+/, "~");
    const machine = (m) => div().flex_none().text_size(10.5).px(6).py(1).rounded(4).border_1().border_color(t.border)
      .text_color(m ? t.accent : t.dim).child(m ?? tr.thisComputer);
    const rows = list.map((c, n) => {
      const on = n === sel;
      const wt = c.kind === "worktree";
      const main = wt
        ? h_flex().flex_1().min_w(0).gap(8).items_center()
          .child(div().flex_none().font_semibold().child(tr.newWorktree))
          .child(div().min_w(0).truncate().text_color(t.muted).child(c.dest ? `${c.branch}  →  ${tilde(c.dest)}` : `${c.branch}  ←  ${tilde(c.folder)}`))
        : c.kind === "open"
        ? h_flex().flex_1().min_w(0).gap(8).items_center()
          .child(div().flex_none().font_semibold().child(tr.openWorktree))
          .child(div().min_w(0).truncate().text_color(t.muted).child(tilde(c.folder)))
          .when(Boolean(c.branch), (el) => el.child(div().flex_none().text_size(11).text_color(t.done).child(c.branch)))
        : h_flex().flex_1().min_w(0).gap(8).items_center()
          .child(div().flex_none().font_semibold().child(c.space.name || tr.space))
          .child(div().min_w(0).truncate().text_color(t.muted).child(tilde(c.folder)))
          .when(Boolean(c.branch), (el) => el.child(div().flex_none().text_size(11).text_color(c.rank === 3 ? t.done : t.dim).child(c.branch)));
      return h_flex().id(`pk-${n}`).h(40).px(12).gap(10).items_center().rounded(8).cursor_pointer()
        .bg(on ? t.selected : t.popover).hover((s) => s.bg(on ? t.selected : t.hover))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { if (on) this.startChoice(c, cx); else { this.pick.sel = n; cx.notify(); } })
        .child(div().w(14).flex_none().text_size(11).text_color(t.dim).child(n < 9 ? String(n + 1) : ""))
        .child(machine(c.space ? c.space.machine : c.machine))
        .child(main)
        .when(c.rank >= 2, (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child(c.rank === 3 ? tr.onBranch : tr.recommended)));
    });
    const busy = this.places.scanning();
    return v_flex().flex_1().min_h(0).w_full().p(16).gap(10)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(15).font_semibold().child(tr.pickTitle(this.agentName(), issue.identifier)))
        .when(busy, (el) => el.child(svg(`${ICON}/spinner.svg`).size(13).text_color(t.dim).spin(900)).child(div().text_size(11.5).text_color(t.dim).child(tr.scanning))))
      .child(div().text_size(12).text_color(t.muted).truncate().child(issue.title))
      .child(v_flex().id("pk-list").flex_1().min_h(0).gap(2).overflow_y_scrollbar().children(rows))
      .child(div().text_size(11.5).text_color(t.dim).child(tr.pickHint));
  }
}
