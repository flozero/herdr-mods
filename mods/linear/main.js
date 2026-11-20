// Linear for the Herdr app: find, read and start work on Linear issues in a window.
// Lists: my open issues · recently opened · all (every team you belong to).
// Typing filters what's already loaded at once and asks the server after a 0.3 s pause.
// Wide windows preview the selected issue on the right; Enter opens it.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView, h_resizable, resizable_panel } from "gpui-base";
import { theme, props, closeOverlay, run, focused, panes, spaces, terminals, exec, hc, home, appHome, nextCommand } from "herdr";
import * as fs from "fs/promises";
import * as api from "./api.js";
import * as Q from "./query.js";
import { Images, splitMarkdown, splitImages, imageParts, imageUrls } from "./media.js";
import { Store, JsonFile } from "./store.js";
import { T, setLanguage } from "./i18n.js";
import { Places } from "./places.js";
import { stateIcon } from "./states.js";
import * as Doc from "./doc.js";
import { historyEntries, createdBy } from "./history.js";
import { projectEvents } from "./activity.js";
import { editPoint, mentionAt, rankPeople, insertMention } from "./mention.js";
import { agentArgv, agentName, askArgv } from "./agent.js";

const BASE = "mods/linear";
const ICON = `${BASE}/icons`;
const WIDE = 760;
const LIST_W = 420; // the list's default width beside the preview; dragging the divider changes it
const LIST_MIN = 280, PREVIEW_MIN = 320;
const RECENT_MAX = 30;
const CACHE_MAX = 400;
const URGENT = "#eb5757";
const CLAUDE = "#D97757";
const SUB_BG = "#3b82f614";
// GitHub's pull request colors.
const PR_COLOR = { open: "#3fb950", draft: null, merged: "#a371f7", closed: "#f85149" };
const PR_ICON = { open: "pr", draft: "pr", merged: "pr-merged", closed: "pr-closed" };
const REVIEW_COLOR = { approved: "#3fb950", changes: "#d29922" };
const PRIO_ICON = { 0: "prio-none", 1: "prio-urgent", 2: "prio-3", 3: "prio-2", 4: "prio-1" };
const TAB_IDS = ["all", "mine", "recent"];
const VIEW_TAB = "v:";
const isViewTab = (tab) => String(tab ?? "").startsWith(VIEW_TAB);
const viewIdOf = (tab) => (isViewTab(tab) ? tab.slice(VIEW_TAB.length) : null);
const IDENT_IN_TEXT = /(?:^|[^a-z0-9])([a-z][a-z0-9]*)-(\d+)(?![0-9])/gi;
const IDENT_IN_NAME = /[A-Za-z][A-Za-z0-9]*-\d+/g;
const WATCH_LABEL = /^linear\.(watch|mr|pipeline)\.([A-Z][A-Z0-9]*-\d+)$/;
const WATCH_RANK = { watch: 1, mr: 2, pipeline: 3 };
const CLAUDE_ICON = "icons/claude.svg";
const BOARD_STEP = 16, BOARD_X = 6;
const TREE_STEP = 22, TREE_X = 7; // a sub-issue level's indent, and where its line runs (under the parent's priority icon)
const CLOSED = new Set(["completed", "canceled", "duplicate"]);
const SORTS = ["default", "updated", "created", "priority", "state"];
const LAYOUTS = ["split", "list", "board"];
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

export default class Linear extends View {
  init(_props, cx) {
    this.focusUntil = Date.now() + 2000;
    this.config = { agent: ["claude"], agentName: null, refreshSeconds: 120, taskContext: true, cacheDays: 30, worktreeMod: null,
      worktreeRepo: null, branchPrefix: null, skill: null };
    this.branchPrefix = null;
    this.origin = props()?.origin ? this.placeOf(props().origin) : this.focusedPlace();
    this.views = [];
    this.viewData = {};
    this.viewer = null;
    this.mine = [];
    this.all = [];
    this.allCursor = null;
    this.allMore = false;
    this.cache = {}; // identifier → issue
    this.recent = []; // identifiers, newest first
    this.found = []; // identifiers in the focused terminal shown on top, last mentioned first
    this.foundIds = []; // every identifier the terminal mentions, cached or not
    this.details = {}; // identifier → detail
    this.server = []; // server filter search results
    this.tab = "all";
    this.query = "";
    this.sel = 0;
    this.mode = "list"; // list | detail
    this.stack = []; // issues followed through relations in the detail view
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
    this.listW = LIST_W;
    this.layout = "split"; // split (list + preview) | list (the list alone, with more columns)
    this.layouts = {};
    this.projectPane = {};
    this.overviews = {};
    this.filters = []; // saved searches: [{ query }]
    this.sort = { by: "default", asc: false }; // list order (default: the list's own, or relevance when searching)
    this.hideClosed = false; // Display: leave completed, canceled and duplicate issues out of the lists
    this.nest = true; // Display: sub-issues under their parent
    this.pop = null; // the open popover: "filter" | "display"
    this.popField = null; // the filter menu's open field (state, assignee, …)
    this.popNeg = false; // the filter menu adds "is not" values
    this.popMenu = null; // the display panel's open choice (order, closed)
    this.confirmDel = null; // the preset whose delete waits for a second press
    this.renaming = null; // the preset being renamed
    this.collapsed = new Set(); // parents whose sub-issues are folded in the list
    this.dataVer = 0; this.foldVer = 0; // bumped when cached issues or folds change (rows() is memoized on them)
    this.height = 700;
    this.lightbox = null; // { urls, idx }: an image shown large over the window
    this.typing = false;
    this.handle = cx.focus_handle();
    this.queryGen = 0; this.previewGen = 0; this.flashGen = 0;
    this.images = new Images();

    // The search hint is drawn beside the input (searchBar) so it follows the language set in config.json.
    this.input = InputState.new({ placeholder: "" });
    this.input.on("change", (_e, cx) => this.onQuery(this.input.value(), cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });

    this.renameInput = InputState.new({ placeholder: "" });
    this.renameInput.on("submit", (_e, cx) => this.finishRename(cx, true));
    this.renameInput.on("blur", (_e, cx) => { if (this.renaming !== null) this.finishRename(cx, true); });

    this.titleInput = InputState.new({ placeholder: "" });
    this.titleInput.on("change", (_e, cx) => cx.notify());
    this.titleInput.on("submit", () => this.bodyDraft.focus());
    this.titleInput.on("focus", (_e, cx) => { this.editFocus = "title"; cx.notify(); });
    this.titleInput.on("blur", (_e, cx) => { if (this.editFocus === "title") this.editFocus = null; cx.notify(); });
    this.bodyDraft = TextareaState.new({ rows: 10 });
    this.bodyDraft.set_auto_grow(8, 40);
    this.bodyDraft.on("change", (_e, cx) => cx.notify());
    this.bodyDraft.on("submit", (e, cx) => { if (e?.secondary) this.saveIssue(cx); });
    this.bodyDraft.on("focus", (_e, cx) => { this.editFocus = "body"; cx.notify(); });
    this.bodyDraft.on("blur", (_e, cx) => { if (this.editFocus === "body") this.editFocus = null; cx.notify(); });

    this.assignInput = InputState.new({ placeholder: "" });
    this.assignInput.on("change", (_e, cx) => { if (this.assignPick) this.assignPick.sel = 0; cx.notify(); });
    this.assignInput.on("submit", (_e, cx) => { const list = this.assignChoices(); this.pickAssignee(list[Math.min(this.assignPick?.sel ?? 0, list.length - 1)], cx); });
    this.popInput = InputState.new({ placeholder: "" });
    this.popInput.on("change", (_e, cx) => cx.notify());
    this.popInput.on("submit", (_e, cx) => {
      const typed = this.pop === "views" ? this.popInput.value() : "";
      const slug = api.viewSlug(typed), pslug = slug ? null : api.projectSlug(typed);
      if (slug) this.addView(slug, cx);
      else if (pslug) this.addView(pslug, cx, "project");
    });

    cx.spawn(async (cx) => {
      // Read the focused terminal right away, so its issues are on the first frame and the list doesn't jump.
      const termText = this.readTerminal();
      await this.loadConfig();
      this.places.worktreeMod = this.config.worktreeMod ?? null;
      this.linearConnected().then((on) => { this.canWrite = on; cx.notify(); });
      this.places.orchestrate = Boolean(this.config.skill);
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
      this.all = load("all", []);
      this.cache = load("cache", {});
      this.recent = load("recent", []);
      this.tab = load("tab", "all");
      this.details = load("details", {});
      this.listW = load("listW", LIST_W);
      this.layout = load("layout", "split");
      this.layouts = load("layouts", {});
      if (LAYOUTS.includes(this.layouts[load("tab", "")])) this.layout = this.layouts[load("tab", "")];
      this.filters = load("filters", []);
      this.sort = { by: "default", asc: false, ...load("sort", {}) };
      this.hideClosed = load("hideClosed", false);
      this.nest = load("nest", this.config.nestSubIssues !== false);
      this.collapsed = new Set(load("collapsed", []));
      this.views = await VIEWS.read(null);
      if (!this.views) { this.views = load("myViews", []); if (this.views.length) VIEWS.write(this.views).catch(() => {}); }
      this.viewData = load("viewData", {});
      if (isViewTab(this.tab) && !this.views.some((v) => v.id === viewIdOf(this.tab))) this.tab = "all";
      this.cleanCache();
      if (this.config.terminalIssues !== false) {
        this.foundIds = Q.issueRefs(await termText, this.teamKeys());
        this.found = this.foundIds.filter((id) => this.cache[id]);
      }
      if (props()?.open === "current" && this.viewer) this.openCurrent(cx);
      else if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(String(props()?.open ?? ""))) { this.openedCurrent = true; this.openDetail(String(props().open).toUpperCase(), cx, true); }
      cx.notify();
      this.focusList();
      this.fetchFound(cx);
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
    cx.timer.after(400, () => { if (!this.typing) this.focusList(); });
    // From keys.json or `herdr-app do`: linear.search[:text], linear.refresh, linear.close, linear.layout[:split|list], linear.open:ENG-123
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
        if (name === "search") {
          this.mode = "list"; this.stack = []; this.focusSearch();
          // linear.search:<text> types the search (the rest of the command, spaces included).
          const text = /^search[:\s](.*)$/s.exec(String(c))?.[1];
          if (text !== undefined) { this.input.set_value(text); this.onQuery(text, cx); }
        }
        else if (name === "refresh") this.reload(cx);
        else if (name === "close") this.dismiss();
        else if (name === "sort" && SORTS.includes(arg)) this.setSort(arg, cx);
        else if (name === "filter" || name === "display") this.openPop(this.pop === name ? null : name, cx);
        else if (name === "layout") this.setLayout(LAYOUTS.includes(arg) ? arg : this.nextLayout(), cx);
        else if (name === "open" && arg) this.openDetail(arg.toUpperCase(), cx, true);
        else if (name === "comments") { const id = this.shownId(); if (id) this.toggleComments(id, cx); }
        else if (name === "jump" && arg) { const id = this.shownId(); const key = /^jump[:\s](.*)$/s.exec(String(c))?.[1]; if (id && key) this.jump(id, key, cx); }
        else if (name === "image") { const g = this.gallery(); if (g.length) this.openLightbox(g[0], cx); }
        else if (name === "work") { const id = this.shownId(); const i = id && (this.details[id]?.issue ?? this.cache[id]); if (i) this.work(i, cx); }
        else if (name === "current") this.openCurrent(cx);
        else if (name === "views") this.openPop(this.pop === "views" ? null : "views", cx);
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
    setLanguage(this.config.language ?? "en");
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
      this.status = { text: T().err[e?.kind] ?? String(e?.message ?? e), level: "error" };
      return undefined;
    } finally {
      this.loading.delete(label); this.redraw(cx);
    }
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
      await this.linearMe(tool, args);
      this.say(done, cx, "success");
      return true;
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

  editIssue(id, cx) {
    if (!this.canWrite) { this.say(T().connectFirst, cx); return; }
    if (this.issueEdit?.id === id) { cx.timer.after(0, () => this.titleInput.focus()); return; }
    cx.spawn(async (cx) => {
      await this.loadDetail(cx, id, true);
      const issue = this.details[id]?.issue;
      if (!issue) return;
      this.issueEdit = { id, title: issue.title ?? "", description: issue.description ?? "" };
      this.titleInput.set_value(this.issueEdit.title);
      this.bodyDraft.set_value(this.issueEdit.description);
      this.jump(id, "top", cx);
      cx.timer.after(0, () => this.titleInput.focus());
      cx.notify();
    });
  }

  issueEdited() {
    const e = this.issueEdit;
    return Boolean(e) && (this.titleInput.value().trim() !== e.title || this.bodyDraft.value() !== e.description);
  }

  cancelEdit(cx) {
    this.issueEdit = null;
    this.editFocus = null;
    this.focusList();
    cx.notify();
  }

  saveIssue(cx) {
    const e = this.issueEdit;
    if (!e || this.sending) return;
    const title = this.titleInput.value().trim(), description = this.bodyDraft.value();
    if (!title) { this.say(T().titleEmpty, cx); return; }
    if (!this.issueEdited()) { this.cancelEdit(cx); return; }
    const args = { id: e.id, ...(title !== e.title ? { title } : {}), ...(description !== e.description ? { description } : {}) };
    cx.spawn(async (cx) => {
      if (!(await this.write("save_issue", args, T().issueSaved(e.id), cx))) return;
      this.cancelEdit(cx);
      await this.loadDetail(cx, e.id, true);
      this.refresh(cx, false);
      cx.notify();
    });
  }

  openAssign(id, cx) {
    if (!this.canWrite) { this.say(T().connectFirst, cx); return; }
    if (this.assignPick?.id === id) { this.closeAssign(cx); return; }
    this.statePick = null;
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
    const [mine, page] = await Promise.all([
      this.call(cx, "mine", () => api.myIssues(this.viewer.id)),
      this.call(cx, "all", () => api.teamIssues(this.teamIds(), null)),
      viewId ? this.loadView(cx, viewId) : null,
    ]);
    if (mine) { this.mine = mine; save("mine", mine.map(slim)); this.remember(mine); }
    if (page) {
      // Keep pages loaded with "Load more"; replace only the first page.
      const fresh = new Set(page.nodes.map((i) => i.id));
      this.all = [...page.nodes, ...(first ? [] : this.all.slice(api.PAGE_SIZE).filter((i) => !fresh.has(i.id)))];
      if (first) { this.allCursor = page.pageInfo.endCursor; this.allMore = page.pageInfo.hasNextPage; }
      save("all", this.all.slice(0, api.PAGE_SIZE).map(slim)); this.remember(page.nodes);
    }
    const shown = this.shownId();
    if (shown) this.loadDetail(cx, shown, true);
    if (this.query) this.searchServer(cx, this.query);
    this.redraw(cx);
  }

  async loadView(cx, viewId, more = false) {
    if (this.loading.has(`v:${viewId}`)) return;
    const have = this.viewData[viewId];
    if (more && !have?.more) return;
    const isProject = this.views?.find((v) => v.id === viewId)?.kind === "project";
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
    return id ? this.views.find((v) => v.id === id) ?? null : null;
  }

  addView(slug, cx, kind = "view") {
    if (this.loading.has("addView")) return;
    cx.spawn(async (cx) => {
      const v = await this.call(cx, "addView", () => (kind === "project" ? api.project(slug) : api.customView(slug)));
      if (v === null || (v && v.modelName && v.modelName !== "Issue")) { this.say(kind === "project" ? T().projectNotFound : T().viewNotFound, cx, "error"); return; }
      if (!v) return;
      const saved = await VIEWS.read([]);
      this.views = saved.some((x) => x.id === v.id) ? saved : [...saved, v];
      try { await VIEWS.write(this.views); } catch (e) { this.say(`${T().viewNotSaved}: ${e?.message ?? e}`, cx, "error"); return; }
      this.popInput.set_value("");
      this.openPop(null, cx);
      if (kind === "project" && !this.layouts[`${VIEW_TAB}${v.id}`]) { this.layouts[`${VIEW_TAB}${v.id}`] = "board"; save("layouts", this.layouts); }
      this.setTab(`${VIEW_TAB}${v.id}`, cx);
      this.say(kind === "project" ? T().projectAdded(v.name) : T().viewAdded(v.name), cx, "success");
    });
  }

  removeView(id, cx) {
    const v = this.views.find((x) => x.id === id);
    cx.spawn(async (cx) => {
      this.views = (await VIEWS.read([])).filter((x) => x.id !== id);
      try { await VIEWS.write(this.views); } catch (e) { this.say(`${T().viewNotSaved}: ${e?.message ?? e}`, cx, "error"); return; }
      const { [id]: _gone, ...rest } = this.viewData;
      this.viewData = rest;
      if (viewIdOf(this.tab) === id) this.setTab("all", cx);
      if (v) this.say(T().viewRemoved(v.name), cx);
      cx.notify();
    });
  }

  tabLabel(tab) {
    return isViewTab(tab) ? this.viewOf(tab)?.name ?? T().views : T().tabs[tab ?? "all"];
  }

  async moreAll(cx) {
    if (!this.allMore || this.loading.has("all")) return;
    const page = await this.call(cx, "all", () => api.teamIssues(this.teamIds(), this.allCursor));
    if (!page) return;
    const have = new Set(this.all.map((i) => i.id));
    this.all.push(...page.nodes.filter((i) => !have.has(i.id)));
    this.allCursor = page.pageInfo.endCursor; this.allMore = page.pageInfo.hasNextPage;
    this.remember(page.nodes);
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
    const add = (id, tab, space) => {
      const r = rank[tab.status] ?? 0;
      if (!out[id] || r > out[id].r) out[id] = { tab, space, r, program: agentIn(tab.id) };
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

  onQuery(text, cx) {
    this.query = text; this.sel = 0;
    const mine = ++this.queryGen;
    cx.timer.after(300, (cx) => { if (mine === this.queryGen) this.searchServer(cx, text); });
    cx.notify();
  }

  async searchServer(cx, text) {
    const q = Q.parse(text);
    if (Q.isEmpty(q)) { this.server = []; return; }
    const found = await this.call(cx, "search", () => api.searchIssues(Q.searchCalls(q)));
    const r = found?.filter((i) => Q.localScore(i, q, this.viewer?.id) >= 0);
    if (r && this.query === text) { this.server = r; this.serverFor = text; this.remember(r); }
  }




  // ── List ──────────────────────────────────────────────

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
    if (id) { this.openDetail(id, cx, true); return; }
    const place = this.origin ?? this.focusedPlace();
    this.say(T().noBranchIssue(place.branch ?? place.cwd ?? "?"), cx);
  }

  // Everything rows() reads. A render asks for the rows several times (selection, preview, list),
  // and a search scores every cached issue, so it's computed once per change.
  rowsKey() {
    return [this.query, this.tab, this.mine, this.all, this.all.length, this.server, this.serverFor,
      this.found, this.recent, this.allMore, this.dataVer, this.foldVer, this.branchIssue(), this.sort.by, this.sort.asc, this.hideClosed, this.nest, this.viewData, this.layout];
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

  // Display "completed issues: hide" leaves closed ones out, unless the search asks for a state.
  visible(list, q) {
    if (!this.hideClosed || q.conds.some((c) => c.field === "state")) return list;
    return list.filter((i) => !CLOSED.has(i.state?.type));
  }

  // Picking the order: another one sets it (in its natural direction), the same one flips it.
  setSort(by, cx) {
    this.sort = by === this.sort.by && by !== "default" ? { by, asc: !this.sort.asc } : { by, asc: false };
    save("sort", this.sort);
    this.sel = 0;
    this.schedulePreview(cx);
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
    const q = Q.parse(this.query);
    if (Q.isEmpty(q)) {
      const viewId = viewIdOf(this.tab);
      let list = viewId ? this.viewData[viewId]?.nodes ?? []
        : this.tab === "mine" ? this.mine : this.tab === "all" ? this.all : this.recent.map((id) => this.cache[id]).filter(Boolean);
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
      out.push(...this.nested(this.sorted(this.visible(list, q))));
      if (this.tab === "all" && this.allMore) out.push({ kind: "more" });
      if (viewId && this.viewData[viewId]?.more) out.push({ kind: "more" });
      return out;
    }
    const seen = new Map();
    // A cached issue shows only when it matches; a server result (bonus 0) shows anyway, since the
    // server saw the whole description and the current state.
    const consider = (i, bonus = -1) => {
      if (!i?.identifier || i.archivedAt || i.trashed) return;
      const s = Math.max(Q.localScore(i, q, this.viewer?.id), bonus);
      if (s < 0) return;
      const prev = seen.get(i.identifier);
      if (!prev || prev.s < s) seen.set(i.identifier, { i, s });
    };
    for (const i of Object.values(this.cache)) consider(i);
    // Server results count only for the search they answered (until the new one comes back).
    if (this.serverFor === this.query) for (const i of this.server) consider(i, 0);
    const ranked = [...seen.values()].sort((a, b) => b.s - a.s || (b.i.updatedAt ?? "").localeCompare(a.i.updatedAt ?? ""));
    out.push(...this.nested(this.sorted(this.visible(ranked.map(({ i }) => i), q))));
    return out;
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
    this.schedulePreview(cx);
    cx.notify();
  }

  // Selects the issue `id` if it's a row (keeps the selection on the same issue when rows move).
  selectIssue(id, cx) {
    const n = this.pickable().findIndex((r) => r.kind === "issue" && r.issue.identifier === id);
    if (n < 0) return false;
    this.sel = n;
    this.schedulePreview(cx);
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
    if (layout === "split") this.schedulePreview(cx);
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
    const walk = (x, guides) => {
      const id = x.r.issue.identifier;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ ...x, guides });
      const ch = (kids.get(id) ?? []).filter((c) => !seen.has(c.r.issue.identifier));
      const up = guides.map((g) => (g === "mid" || g === "line" ? "line" : "none"));
      ch.forEach((c, n) => walk(c, [...up, n === ch.length - 1 ? "end" : "mid"]));
    };
    roots.forEach((x) => walk(x, []));
    for (const x of cards) if (!seen.has(x.r.issue.identifier)) out.push({ ...x, guides: [] });
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

  // ── Saved filters ─────────────────────────────────────
  // A saved filter is a search (words and tokens). ⌃S saves the current one (or removes it if saved),
  // a pill or ⌃1–9 runs one, running the active one again clears the search.

  // A preset is a search and, when it was saved with one, a display (order, closed issues hidden):
  // { query, sort?, hideClosed? }. It's the active one when the window shows exactly that.
  displayIsDefault() { return this.sort.by === "default" && !this.sort.asc && !this.hideClosed; }

  presetMatches(f) {
    if (f.query !== this.query.trim()) return false;
    if (!f.query && f.tab && f.tab !== this.tab) return false;
    if (!f.sort) return f.query !== "" || this.displayIsDefault();
    return f.sort.by === this.sort.by && Boolean(f.sort.asc) === this.sort.asc && Boolean(f.hideClosed) === this.hideClosed;
  }

  savedIndex() {
    // A preset with a display beats one with the same search alone.
    const n = this.filters.findIndex((f) => f.sort && this.presetMatches(f));
    return n >= 0 ? n : this.filters.findIndex((f) => !f.sort && this.presetMatches(f));
  }

  canSave() { return Boolean(this.query.trim()) || !this.displayIsDefault(); }

  presetLabel(f) {
    const tr = T();
    if (f.name) return f.name;
    const parts = [f.query || this.tabLabel(f.tab)];
    if (f.sort && f.sort.by !== "default") parts.push(`${f.sort.asc ? "↑" : "↓"} ${tr.sort[f.sort.by]}`);
    else if (f.sort?.asc) parts.push("↑");
    if (f.hideClosed) parts.push(tr.closedHidden);
    return parts.join(" · ");
  }

  // ⌃S (or the + pill, or the filter menu): saves what's shown as a preset, or removes the active one.
  // The display goes in only when it isn't the default, so a search-only preset leaves the order alone.
  toggleSaveFilter(cx) {
    const n = this.savedIndex();
    if (n >= 0) { this.askDelete(n, cx); return; }
    else if (!this.canSave()) { this.say(T().filterEmpty, cx); return; }
    else {
      const f = { query: this.query.trim() };
      if (!f.query) f.tab = this.tab; // a display alone applies to a view
      if (!this.displayIsDefault()) { f.sort = { ...this.sort }; f.hideClosed = this.hideClosed; }
      this.filters = [...this.filters, f];
      this.say(T().filterSaved(this.presetLabel(f)), cx, "success");
    }
    save("filters", this.filters);
    cx.notify();
  }

  // Deleting takes a second press within 3 s: the first turns × into "Delete?".
  askDelete(n, cx) {
    if (this.confirmDel === n) { this.confirmDel = null; this.removeFilter(n, cx); cx.notify(); return; }
    this.confirmDel = n;
    this.say(T().confirmDelete(this.presetLabel(this.filters[n])), cx);
    cx.timer.after(3000, (cx) => { if (this.confirmDel === n) { this.confirmDel = null; cx.notify(); } });
    cx.notify();
  }

  // Rename: ✎ on the active preset turns its pill into a field. Enter or leaving it keeps the name
  // (empty goes back to the search as the name), Esc cancels.
  startRename(n, cx) {
    const f = this.filters[n];
    if (!f) return;
    this.renaming = n; this.confirmDel = null;
    this.renameInput.set_value(f.name ?? "");
    cx.timer.after(0, () => this.renameInput.focus());
    cx.notify();
  }

  finishRename(cx, keep) {
    const n = this.renaming;
    if (n === null) return;
    this.renaming = null;
    const f = this.filters[n];
    if (keep && f) {
      const name = this.renameInput.value().trim();
      this.filters = this.filters.map((x, k) => (k === n ? (name && name !== x.query ? { ...x, name } : (({ name: _n, ...rest }) => rest)(x)) : x));
      save("filters", this.filters);
      this.say(T().presetRenamed(this.presetLabel(this.filters[n])), cx, "success");
    }
    if (this.mode === "list") this.focusList();
    cx.notify();
  }

  removeFilter(n, cx) {
    const f = this.filters[n];
    if (!f) return;
    this.filters = this.filters.filter((_f, k) => k !== n);
    save("filters", this.filters);
    this.say(T().filterRemoved(this.presetLabel(f)), cx);
  }

  // Runs a preset (its display too; what was shown before comes back when it's turned off). Running the
  // active one again clears it.
  applyFilter(n, cx) {
    const f = this.filters[n];
    if (!f) return;
    const off = this.savedIndex() === n;
    if (this.mode === "detail") { this.stack = []; this.mode = "list"; }
    if (off) {
      if (this.displayBefore) { this.sort = this.displayBefore.sort; this.hideClosed = this.displayBefore.hideClosed; this.displayBefore = null; }
    } else if (f.sort) {
      this.displayBefore ??= { sort: { ...this.sort }, hideClosed: this.hideClosed };
      this.sort = { ...f.sort }; this.hideClosed = Boolean(f.hideClosed);
    } else if (this.displayBefore) {
      this.sort = this.displayBefore.sort; this.hideClosed = this.displayBefore.hideClosed; this.displayBefore = null;
    }
    save("sort", this.sort); save("hideClosed", this.hideClosed);
    const q = off ? "" : f.query;
    if (!off && !f.query && f.tab) { this.tab = f.tab; save("tab", f.tab); }
    this.sel = 0;
    this.input.set_value(q);
    this.onQuery(q, cx);
    this.focusList();
    cx.notify();
  }

  schedulePreview(cx) {
    if (this.width < WIDE || this.layout !== "split") return;
    const id = this.shownId();
    if (!id) return;
    const gen = ++this.previewGen;
    cx.timer.after(220, (cx) => { if (gen === this.previewGen) this.loadDetail(cx, id); });
  }

  activate(r, cx) {
    if (!r) return;
    if (r.kind === "issue") this.openDetail(r.issue.identifier, cx, true);
    else if (r.kind === "more") { const v = viewIdOf(this.tab); if (v) this.loadView(cx, v, true); else this.moreAll(cx); }
  }

  openDetail(id, cx, reset) {
    this.stack = reset ? [id] : [...this.stack, id];
    this.mode = "detail";
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    save("recent", this.recent);
    this.loadDetail(cx, id);
    this.focusList();
    cx.notify();
  }

  back(cx) {
    this.stack.pop();
    if (!this.stack.length && props()?.side) { this.dismiss(); return; }
    if (!this.stack.length) { this.mode = "list"; this.focusList(); }
    else this.loadDetail(cx, this.stack[this.stack.length - 1]);
    cx.notify();
  }

  setTab(tab, cx) {
    this.tab = tab; save("tab", tab); this.sel = 0;
    if (LAYOUTS.includes(this.layouts?.[tab])) this.layout = this.layouts[tab];
    const viewId = viewIdOf(tab);
    if (viewId) cx.spawn(async (cx) => this.loadView(cx, viewId));
    if (this.query) { this.query = ""; this.input.set_value(""); }
    this.schedulePreview(cx);
    cx.notify();
  }

  focusList() { this.typing = false; this.handle.focus(); }
  focusSearch() { this.typing = true; this.input.focus(); }

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
    if (props()?.overlay || this.typing || this.pop || this.renaming !== null) return;
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
    const head = asked ?? (this.config.skill ? T().taskSkill(issue, this.config.skill) : T().task(issue));
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
    this.flash = { text, level };
    const gen = ++this.flashGen;
    cx.timer.after(1800, (cx) => { if (gen === this.flashGen) { this.flash = null; cx.notify(); } });
    cx.notify();
  }

  // ── Outline ───────────────────────────────────────────
  // The detail scrolls by our own offset (a plain scroll area can't be moved from code): the wheel moves
  // it, each item reports its height, so we know where every heading and thread is. The outline marks
  // the one at the top of the view and the ones on screen, follows as the page scrolls, and a click
  // scrolls the page to that item.

  scrollOf(id) {
    if (!this.sc[id]) this.sc[id] = { y: 0, view: 0, content: 0, h: {}, tops: {}, keys: ["top"], active: "top", ol: 0, olView: 0, olFollow: null };
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
    S.olFollow = null;
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
    exec("sh", ["-c", 'find "$1" -maxdepth 1 -type f ! -name data.json ! -name views.json -mtime +"$2" -delete', "sh", `${appHome()}/${BASE}/.cache`, String(days)]).catch(() => {});
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
    this.pick = { issue, sel: 0 };
    cx.spawn(async (cx) => { await this.places.scanAll(); cx.notify(); });
    cx.notify();
  }

  choices() {
    if (!this.pick) return [];
    return this.places.choices(this.pick.issue);
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
    if (k === "cmd-r") { this.reload(cx); cx.stop_propagation(); return; }
    if (this.handle.is_focused()) this.typing = false;
    const id = this.shownId();
    const issue = id ? (this.details[id]?.issue ?? this.cache[id]) : null;
    if (this.editFocus) {
      if (k === "cmd-enter" || k === "ctrl-enter") { this.saveIssue(cx); cx.stop_propagation(); }
      else if (k === "escape") { this.focusList(); this.editFocus = null; cx.notify(); cx.stop_propagation(); }
      else if (k === "tab" && this.editFocus === "title") { this.bodyDraft.focus(); cx.stop_propagation(); }
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
    if (this.statePick && this.stateKey(k, cx)) { cx.stop_propagation(); return; }
    if (this.renaming !== null) {
      if (k === "escape") { this.finishRename(cx, false); cx.stop_propagation(); }
      return;
    }
    if (this.pop) {
      if (k === "ctrl-s") { this.toggleSaveFilter(cx); cx.stop_propagation(); return; }
      if (k === "escape") {
        if (this.popField) { this.popField = null; this.popInput.set_value(""); cx.notify(); } else this.openPop(null, cx);
        cx.stop_propagation();
      }
      return;
    }
    if (this.lightbox) { this.lightboxKey(k, cx); cx.stop_propagation(); return; }
    if (this.pick) { if (this.pickKey(k, cx)) cx.stop_propagation(); return; }
    if (this.mode === "detail") {
      if (k === "escape" && this.issueEdit) { this.issueEdited() ? this.say(T().editPending, cx) : this.cancelEdit(cx); cx.stop_propagation(); return; }
      const m = {
        escape: () => this.back(cx), backspace: () => this.back(cx), q: () => this.dismiss(),
        o: () => issue && this.openUrl(issue.url, cx), y: () => issue && this.copy(issue.url, "URL", cx),
        "shift-y": () => { const pr = api.mainPr(issue); pr ? this.copy(pr.url, T().prLink, cx) : this.say(T().noPr, cx); },
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
        e: () => id && this.editIssue(id, cx),
      };
      if (!m[k]) return;
      m[k](); cx.stop_propagation(); return;
    }
    const step = (d) => this.setTab(TAB_IDS[(TAB_IDS.indexOf(this.tab) + d + TAB_IDS.length) % TAB_IDS.length], cx);
    const m = {
      down: () => this.move(1, cx), up: () => this.move(-1, cx),
      "ctrl-n": () => this.move(1, cx), "ctrl-p": () => this.move(-1, cx),
      pagedown: () => this.move(10, cx), pageup: () => this.move(-10, cx),
      tab: () => step(1), "shift-tab": () => step(-1),
      "ctrl-o": () => issue && this.openUrl(issue.url, cx),
      "ctrl-y": () => issue && this.copy(issue.url, "URL", cx),
      "ctrl-r": () => this.reload(cx),
      "ctrl-l": () => this.setLayout(this.nextLayout(), cx),
      "shift-o": () => this.projectTab() && this.setProjectPane(this.overviewShown() ? "issues" : "overview", cx),
      "ctrl-s": () => this.toggleSaveFilter(cx),
      escape: () => {
        const had = Boolean(this.query);
        if (had) { this.input.set_value(""); this.onQuery("", cx); }
        if (this.typing) this.focusList();
        else if (!had) this.dismiss();
      },
      enter: () => (this.typing ? this.focusList() : this.activate(this.selected(), cx)),
      "cmd-f": () => this.focusSearch(), "ctrl-f": () => this.focusSearch(),
    };
    if (!this.typing) {
      Object.assign(m, { "/": () => this.focusSearch(), r: () => this.reload(cx),
        left: () => this.foldKey(-1, cx), right: () => this.foldKey(1, cx) });
    }
    if (this.layout === "board") {
      Object.assign(m, { down: () => this.boardMove(0, 1, cx), up: () => this.boardMove(0, -1, cx), "ctrl-n": () => this.boardMove(0, 1, cx), "ctrl-p": () => this.boardMove(0, -1, cx) });
      if (!this.typing) Object.assign(m, { left: () => this.boardMove(-1, 0, cx), right: () => this.boardMove(1, 0, cx) });
    }
    const fk = /^ctrl-([1-9])$/.exec(k);
    if (fk && this.filters[Number(fk[1]) - 1]) m[k] = () => this.applyFilter(Number(fk[1]) - 1, cx);
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
    const wide = this.width >= WIDE;
    if (this.pick) return root.child(this.header(t)).child(this.pickView(t)).child(this.footer(t));
    const body = this.mode === "detail"
      ? this.detailView(t, this.stack[this.stack.length - 1], true)
      : this.overviewShown() ? this.overviewView(t, this.projectTab())
      : this.layout === "board" ? this.boardView(t)
      : wide && this.layout === "split"
        ? h_resizable("linear-split").flex_1().min_h(0).w_full()
          .on_resize((sizes, cx) => { if (sizes[0] > 0) { this.listW = Math.round(sizes[0]); save("listW", this.listW); cx.notify(); } })
          .child(resizable_panel().size(this.listW).size_range(LIST_MIN, Math.max(LIST_MIN, this.width - PREVIEW_MIN))
            .child(v_flex().size_full().min_h(0).child(this.listView(t))))
          .child(resizable_panel().size_range(PREVIEW_MIN)
            .child(v_flex().size_full().min_w(0).min_h(0).child(this.shownId() ? this.detailView(t, this.shownId(), false) : this.empty(t, T().selectHint))))
        : this.listView(t);
    return root.child(this.header(t)).when(this.mode === "list", (el) => el.child(this.searchBar(t))).child(body).child(this.footer(t))
      .when(Boolean(this.pop) && this.mode === "list", (el) => el.child(this.popView(t)))
      .when(Boolean(this.lightbox), (el) => el.child(this.lightboxView(t)));
  }

  header(t) {
    const busy = this.loading.size > 0;
    return h_flex().h(42).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(14).font_semibold().child("Linear"))
      .child(div().text_size(11.5).text_color(t.dim).child(this.viewer?.organization?.name ?? ""))
      .child(div().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(`·  ${this.tabLabel(this.tab)}`))
      .when(Boolean(this.projectTab()) && this.mode === "list", (el) => el.child(h_flex().flex_none().p(2).gap(2).rounded(7).border_1().border_color(t.border)
        .children([["issues", T().projectIssues], ["overview", T().projectOverview]].map(([key, label]) => {
          const on = (this.projectPane[this.tab] ?? "issues") === key;
          return h_flex().id(`pp-${key}`).h(20).px(8).items_center().rounded(5).text_size(11.5).cursor_pointer()
            .bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(on ? t.selected : t.hover))
            .on_mouse_down("left", stop).on_click((_e, cx) => this.setProjectPane(key, cx)).child(label);
        }))))
      .child(div().flex_1())
      .when(busy, (el) => el.child(svg(`${ICON}/spinner.svg`).size(13).text_color(t.dim).spin(900)))
      .when(this.width >= WIDE, (el) => el.child(this.layoutSwitch(t)))
      .child(this.iconButton(t, "l-refresh", "↻", (cx) => this.reload(cx)))
      .when(Boolean(props()?.overlay) || Boolean(props()?.side), (el) => el.child(this.iconButton(t, "l-close", svg(`${ICON}/close.svg`).size(13), () => this.dismiss())));
  }

  // Split (list + preview) or the list alone. ⌃L flips it.
  layoutSwitch(t) {
    const tr = T().layout;
    const seg = (key, label) => {
      const on = this.layout === key;
      return h_flex().id(`ly-${key}`).h(22).px(8).items_center().rounded(5).text_size(11.5)
        .bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.setLayout(key, cx)).child(label);
    };
    return h_flex().p(2).gap(2).rounded(7).border_1().border_color(t.border)
      .child(seg("split", tr.split)).child(seg("list", tr.list)).child(seg("board", tr.board));
  }

  iconButton(t, id, label, action) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => action(cx)).child(label);
  }

  searchBar(t) {
    return v_flex().px(12).py(8).gap(8).flex_none().border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center().child(h_flex().id("l-search").h(34).flex_1().px(10).gap(8).items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
        .on_mouse_down("left", stop)
        .child(svg(`${ICON}/search.svg`).size(14).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .when(!this.query, (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(T().searchPlaceholder))))
        .child(this.popButton(t, "filter", `${ICON}/filter.svg`, T().filter, Q.parse(this.query).conds.length > 0))
        .child(this.popButton(t, "display", `${ICON}/sliders.svg`, T().display, this.sort.by !== "default" || this.sort.asc || this.hideClosed || !this.nest)))
      .child(this.filterBar(t));
  }

  // ── Filter and display popovers ───────────────────────
  // Two buttons beside the search, as in Linear. Filter picks values (state, assignee, priority, label,
  // team) and writes them into the search as tokens, so what it does stays visible and editable.
  // Display sets the order, whether closed issues show and whether sub-issues nest.

  openPop(which, cx) {
    this.pop = which;
    this.popField = null; this.popNeg = false; this.popMenu = null;
    if (which === "filter" || which === "views") { this.popInput.set_value(""); cx.timer.after(0, () => this.popInput.focus()); }
    if (which === "views") cx.spawn(async (cx) => { this.views = await VIEWS.read(this.views); cx.notify(); });
    else if (!which && this.mode === "list") this.focusList();
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

  setQuery(text, cx) {
    this.input.set_value(text);
    this.onQuery(text, cx);
    cx.notify();
  }

  // What each field offers, from the loaded issues (and the viewer's teams).
  filterValues(field) {
    const issues = [...this.mine, ...this.all, ...Object.values(this.cache)];
    const uniq = (list, key) => [...new Map(list.filter(Boolean).map((x) => [key(x), x])).values()];
    if (field === "s") {
      return uniq(issues.map((i) => i.state), (s) => s.name)
        .sort((a, b) => (STATE_RANK[a.type] ?? 9) - (STATE_RANK[b.type] ?? 9) || a.name.localeCompare(b.name))
        .map((s) => ({ val: s.name, label: s.name, icon: stateIcon(s), color: s.color }));
    }
    if (field === "@") {
      const me = this.viewer?.id;
      const people = uniq(issues.map((i) => i.assignee), (a) => a.id).filter((a) => a.id !== me)
        .map((a) => a.displayName ?? a.name).sort((a, b) => a.localeCompare(b));
      return [{ val: "me", label: T().me }, ...people.map((n) => ({ val: n, label: n }))];
    }
    if (field === "p") {
      return [["urgent", 1], ["high", 2], ["medium", 3], ["low", 4], ["none", 0]].map(([val, n]) => ({ val, label: T().priority[n] ?? T().noPriority, prio: n }));
    }
    if (field === "l") {
      return uniq(issues.flatMap((i) => i.labels?.nodes ?? []), (l) => l.name).sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => ({ val: l.name, label: l.name, dot: l.color }));
    }
    return (this.viewer?.teams?.nodes ?? []).map((tm) => ({ val: tm.key, label: `${tm.key}  ${tm.name}` }));
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
    const views = this.pop === "views";
    const panel = views ? this.viewsPanel(t) : this.pop === "filter" ? this.filterPanel(t) : this.displayPanel(t);
    const at = div().id("pop-panel").absolute().top(views ? 124 : 88);
    return div().absolute().inset_0()
      .child(div().id("pop-back").absolute().inset_0().on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.openPop(null, cx); }))
      .child((views ? at.left(12) : at.right(12)).on_mouse_down("left", stop).on_scroll_wheel((_e, cx) => cx.stop_propagation())
        .child(panel.rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_lg()));
  }

  viewsPanel(t) {
    const tr = T();
    const typed = this.popInput.value().trim();
    const slug = api.viewSlug(typed), pslug = slug ? null : api.projectSlug(typed);
    const term = slug || pslug ? "" : typed.toLowerCase();
    const label = (v) => `${v.name} ${v.team?.key ?? ""}`.toLowerCase();
    const list = [...this.views]
      .filter((v) => !term || label(v).includes(term))
      .sort((a, b) => Number(a.shared) - Number(b.shared) || (a.team?.key ?? "").localeCompare(b.team?.key ?? "") || a.name.localeCompare(b.name));
    const head = h_flex().h(40).px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(Input.new(this.popInput).flex_1().h_full().text_size(12.5))
      .when(!this.popInput.value(), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(tr.viewsFind)));
    const rows = list.map((v, n) => this.menuRow(t, `pv-view-${n}`, this.tab === `${VIEW_TAB}${v.id}`, (cx) => { this.openPop(null, cx); this.setTab(`${VIEW_TAB}${v.id}`, cx); })
      .child(div().w(12).flex_none().text_color(t.accent).child(this.tab === `${VIEW_TAB}${v.id}` ? "✓" : ""))
      .child(div().size(8).flex_none().rounded(4).bg(v.color ?? t.dim))
      .child(div().flex_1().min_w(0).truncate().child(v.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(v.kind === "project" ? tr.project : v.shared ? v.team?.key ?? tr.workspace : tr.personal))
      .child(div().id(`pv-del-${n}`).flex_none().px(4).rounded(4).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.removeView(v.id, cx)).child("×")));
    const fresh = (slug || pslug) && !this.views.some((v) => v.slugId === (slug ?? pslug));
    const add = fresh ? this.menuRow(t, "pv-add", true, (cx) => (slug ? this.addView(slug, cx) : this.addView(pslug, cx, "project")))
      .child(div().w(8).flex_none().text_color(t.accent).child("+"))
      .child(div().flex_1().min_w(0).truncate().child(this.loading.has("addView") ? tr.loading : slug ? tr.addView : tr.addProject))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("↵")) : null;
    const body = v_flex().id("pop-views").p(6).gap(1).max_h(420).overflow_y_scrollbar()
      .when(Boolean(add), (el) => el.child(add))
      .children(rows)
      .when(!rows.length && !add, (el) => el.child(div().p(10).text_size(12).text_color(t.dim).child(tr.noViews)));
    return v_flex().w(340).child(head).child(body);
  }

  menuRow(t, id, on, action) {
    return h_flex().id(id).h(30).px(10).gap(9).items_center().rounded(6).flex_none().text_size(12.5).cursor_pointer()
      .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => action(cx));
  }

  filterPanel(t) {
    const tr = T();
    const term = this.popInput.value().trim().toLowerCase();
    const head = h_flex().h(40).px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(Input.new(this.popInput).flex_1().h_full().text_size(12.5))
      .when(!this.popInput.value(), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(this.popField ? tr.filterFind : tr.addFilter)));
    const FIELDS = [["s", tr.fields.state, `${ICON}/state-started.svg`], ["@", tr.fields.assignee, `${ICON}/person.svg`],
      ["p", tr.fields.priority, `${ICON}/prio-2.svg`], ["l", tr.fields.label, `${ICON}/label.svg`], ["#", tr.fields.team, `${ICON}/team.svg`]];
    const list = v_flex().id("pop-list").p(6).gap(1).max_h(380).overflow_y_scrollbar();
    if (!this.popField) {
      const fields = FIELDS.filter(([, label]) => !term || label.toLowerCase().includes(term));
      // Typing finds values across every field too.
      const hits = term ? FIELDS.flatMap(([f, label]) => this.filterValues(f).filter((v) => v.label.toLowerCase().includes(term)).slice(0, 6).map((v) => ({ ...v, f, fl: label }))) : [];
      list.children(fields.map(([f, label, icon]) => this.menuRow(t, `pf-${f}`, false, (cx) => { this.popField = f; this.popInput.set_value(""); cx.notify(); })
        .child(svg(icon).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(label))
        .when(Q.chosen(this.query, f).length > 0, (el) => el.child(div().text_size(11).text_color(t.accent).child(String(Q.chosen(this.query, f).length))))
        .child(div().text_size(11).text_color(t.dim).child("›"))));
      list.children(hits.map((v, n) => this.valueRow(t, v.f, v, `ph-${n}`, v.fl)));
      if (Q.parse(this.query).conds.length) {
        list.child(div().h(1).my(4).bg(t.border))
          .child(this.menuRow(t, "pf-clear", false, (cx) => this.setQuery(Q.withoutTokens(this.query), cx))
            .child(div().w(14).flex_none().text_color(t.dim).child("×")).child(div().flex_1().text_color(t.muted).child(tr.clearFilters)));
      }
      return v_flex().w(280).child(head).child(list).child(this.presetFooter(t));
    }
    const f = this.popField;
    const label = FIELDS.find((x) => x[0] === f)?.[1] ?? "";
    const seg = (neg, text) => h_flex().id(`pn-${neg}`).h(24).px(10).items_center().rounded(5).text_size(11.5).cursor_pointer()
      .bg(this.popNeg === neg ? t.selected : t.popover).text_color(this.popNeg === neg ? t.foreground : t.muted)
      .on_mouse_down("left", stop).on_click((_e, cx) => { this.popNeg = neg; cx.notify(); }).child(text);
    const bar = h_flex().h(38).px(8).gap(8).items_center().border_b(1).border_color(t.border)
      .child(h_flex().id("pf-back").h(26).px(6).gap(4).items_center().rounded(6).text_size(12.5).font_semibold().cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.popField = null; this.popInput.set_value(""); cx.notify(); }).child("‹").child(label))
      .child(div().flex_1())
      .child(h_flex().p(2).gap(2).rounded(7).border_1().border_color(t.border).child(seg(false, tr.is)).child(seg(true, tr.isNot)));
    const vals = this.filterValues(f).filter((v) => !term || v.label.toLowerCase().includes(term));
    list.children(vals.map((v, n) => this.valueRow(t, f, v, `pv-${n}`)));
    if (!vals.length) list.child(div().p(10).text_size(12).text_color(t.dim).child(tr.noMatch));
    return v_flex().w(280).child(bar).child(head).child(list).child(this.presetFooter(t));
  }

  // Under both menus: save what's shown as a preset (or that it's saved, with remove).
  presetFooter(t) {
    const tr = T(), n = this.savedIndex();
    if (n < 0 && !this.canSave()) return div();
    return h_flex().id("pf-save").h(36).px(12).gap(8).items_center().border_t(1).border_color(t.border).text_size(12)
      .text_color(n >= 0 ? t.muted : t.accent).cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.toggleSaveFilter(cx))
      .child(div().flex_1().child(n >= 0 ? tr.presetSaved : tr.savePreset))
      .child(div().text_size(10.5).text_color(t.dim).child("⌃S"));
  }

  // One value: ✓ when it's in the search with the sign being added (⊘ when it's there as "is not").
  valueRow(t, f, v, id, fieldLabel) {
    const got = Q.chosen(this.query, f).find((c) => c.val.toLowerCase() === v.val.toLowerCase());
    const on = got && got.neg === this.popNeg;
    return this.menuRow(t, id, false, (cx) => this.setQuery(Q.toggleValue(this.query, f, this.popNeg, v.val), cx))
      .child(div().w(14).flex_none().text_size(12).text_color(got ? (got.neg ? t.blocked : t.accent) : t.dim).child(got ? (got.neg ? "⊘" : "✓") : ""))
      .when(Boolean(v.icon), (el) => el.child(svg(v.icon).size(13).flex_none().text_color(v.color ?? t.dim)))
      .when(v.prio !== undefined, (el) => el.child(this.prioIcon(t, v.prio)))
      .when(Boolean(v.dot), (el) => el.child(div().size(8).flex_none().rounded(4).bg(v.dot)))
      .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(v.label))
      .when(Boolean(fieldLabel), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(fieldLabel)));
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
        .when(this.canSave() || this.savedIndex() >= 0, (el) => el.child(this.button(t, "pd-save", this.savedIndex() >= 0 ? tr.presetSaved : tr.savePreset, (cx) => this.toggleSaveFilter(cx), this.savedIndex() < 0)))
        .child(this.button(t, "pd-reset", tr.reset, (cx) => this.resetDisplay(cx))));
  }

  // Saved filters as pills; the active one is selected and has × to remove it. "+ Save" for a new search.
  filterBar(t) {
    const tr = T();
    const active = this.savedIndex();
    const pill = (id) => h_flex().id(id).h(24).px(9).gap(6).items_center().rounded(12).border_1().text_size(11.5).cursor_pointer()
      .on_mouse_down("left", stop);
    // The built-in views first (All, My issues, Recent: lists of their own, not searches), then saved searches.
    const count = { mine: this.mine.length, recent: this.recent.length, all: this.all.length };
    const views = TAB_IDS.map((id) => {
      const on = !this.query.trim() && this.tab === id;
      return pill(`lt-${id}`).border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover)
        .text_color(on ? t.foreground : t.muted).hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.setTab(id, cx); this.focusList(); })
        .child(tr.tabs[id]).child(div().text_size(10.5).text_color(t.dim).child(String(count[id] ?? "")));
    });
    const activeView = this.viewOf(this.tab);
    const viewOn = Boolean(activeView) && !this.query.trim();
    const viewsPill = pill("lt-views").border_color(viewOn || this.pop === "views" ? t.accent : t.border).bg(viewOn ? t.selected : t.popover)
      .text_color(viewOn ? t.foreground : t.muted).hover((s) => s.bg(viewOn ? t.selected : t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.openPop(this.pop === "views" ? null : "views", cx))
      .child(div().max_w(220).truncate().child(activeView ? activeView.name : tr.views))
      .when(viewOn, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(String(this.viewData[activeView.id]?.nodes?.length ?? ""))))
      .child(div().text_size(10).text_color(t.dim).child("▾"));
    return h_flex().gap(6).flex_wrap().items_center()
      .children(views)
      .child(viewsPill)
      .when(this.filters.length > 0, (el) => el.child(div().w(1).h(16).mx(2).bg(t.border)))
      .children(this.filters.map((f, n) => {
        const on = n === active;
        if (this.renaming === n) {
          return h_flex().id(`lf-r-${n}`).h(24).w(200).px(9).gap(6).items_center().rounded(12).border_1().border_color(t.accent).bg(t.background)
            .on_mouse_down("left", stop)
            .child(Input.new(this.renameInput).flex_1().h_full().text_size(11.5))
            .when(!this.renameInput.value(), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(tr.renameHint)));
        }
        const asking = this.confirmDel === n;
        const icon = (id, label, action, color) => div().id(id).px(3).rounded(4).text_color(color ?? t.dim).hover((s) => s.text_color(t.foreground).bg(t.hover))
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(label);
        return pill(`lf-${n}`).border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover)
          .text_color(on ? t.foreground : t.muted).hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.applyFilter(n, cx))
          .when(n < 9, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`⌃${n + 1}`)))
          .when(Boolean(f.sort), (el) => el.child(svg(`${ICON}/sliders.svg`).size(11).flex_none().text_color(on ? t.accent : t.dim)))
          .child(div().max_w(260).truncate().child(this.presetLabel(f)))
          .when(on || asking, (el) => el.child(icon(`lf-e-${n}`, "✎", (cx) => this.startRename(n, cx))))
          .when(on || asking, (el) => el.child(asking
            ? icon(`lf-x-${n}`, tr.deleteAsk, (cx) => this.askDelete(n, cx), t.blocked)
            : icon(`lf-x-${n}`, "×", (cx) => this.askDelete(n, cx))));
      }))
      .when(this.canSave() && active < 0, (el) => el.child(pill("lf-save").border_color(t.border).text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.toggleSaveFilter(cx))
        .child(tr.saveFilter).child(div().text_size(10.5).text_color(t.dim).child("⌃S"))));
  }

  listView(t) {
    const rows = this.rows();
    if (!rows.length) {
      const msg = this.query ? (this.loading.has("search") ? T().searching : T().noMatch)
        : this.tab === "recent" ? T().noRecent : this.loading.size ? T().loading : T().noIssues;
      if (!this.canWrite && !this.query) return this.empty(t, msg).gap(10)
        .child(this.button(t, "l-connect", this.connecting ? T().connecting : T().connectLinear, (cx) => this.connect(cx)));
      return this.empty(t, msg);
    }
    const pickable = rows.filter((r) => r.kind !== "head");
    const sel = pickable[Math.min(this.sel, pickable.length - 1)];
    return v_flex().id("l-list").flex_1().w_full().min_h(0).py(4).overflow_y_scrollbar()
      .children(rows.map((r, n) => this.row(t, r, r === sel, pickable.indexOf(r), n)));
  }

  boardView(t) {
    const cols = this.boardColumns();
    const extras = this.pickable().filter((r) => r.kind === "more");
    if (!cols.length && !extras.length) return this.listView(t);
    const sel = this.selected();
    const busy = this.loading.has("all") || this.loading.has(`v:${viewIdOf(this.tab)}`);
    return v_flex().flex_1().min_h(0).w_full()
      .when(extras.length > 0, (el) => el.child(h_flex().px(12).pt(10).gap(8).children(extras.map((r) =>
        this.button(t, `bx-${r.kind}`, busy ? T().loading : T().more, (cx) => this.activate(r, cx))))))
      .child(h_flex().id("l-board").flex_1().min_h(0).w_full().p(12).gap(12).overflow_x_scrollbar()
        .children(cols.map((col, n) => v_flex().w(BOARD_COL).flex_none().h_full().min_h(0).gap(8)
          .child(h_flex().h(26).px(4).gap(8).items_center().flex_none()
            .child(svg(stateIcon(col.state)).size(14).flex_none().text_color(col.state.color ?? t.dim))
            .child(div().min_w(0).truncate().text_size(12.5).font_semibold().child(col.key))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(col.cards.length))))
          .child(v_flex().id(`bc-${n}`).flex_1().min_h(0).gap(6).overflow_y_scrollbar()
            .children(col.cards.map((x) => this.boardCard(t, x, x.r === sel)))))));
  }

  boardCard(t, x, on) {
    const { r, index } = x, i = r.issue;
    const pr = api.mainPr(i), link = this.links?.[i.identifier];
    const labels = (i.labels?.nodes ?? []).slice(0, 3);
    const who = i.assignee?.displayName ?? i.assignee?.name ?? null;
    const mine = this.assignedToMe(i);
    const nested = (x.guides?.length ?? 0) > 0;
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
        .when(Boolean(link), (el) => el.child(this.agentBadge(t, link, `bb-${i.identifier}`))))
      .when(Boolean(i.parent) && !nested, (el) => el.child(h_flex().w_full().gap(4).text_size(10.5).text_color(t.dim)
        .child(div().flex_none().child("↳")).child(div().flex_none().child(i.parent.identifier))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(i.parent.title ?? ""))))
      .child(div().w_full().text_size(12.5).child(i.title))
      .when(labels.length > 0 || Boolean(who), (el) => el.child(h_flex().gap(4).items_center()
        .children(labels.map((l) => h_flex().h(18).px(6).gap(4).items_center().rounded(9).border_1().border_color(t.border).text_size(10.5).text_color(t.muted)
          .child(div().size(6).rounded(3).bg(l.color ?? t.dim)).child(div().max_w(80).truncate().child(l.name))))
        .child(div().flex_1())
        .when(Boolean(who), (el) => el.child(h_flex().flex_none().gap(5).items_center()
          .child(this.avatar(t, who, 16)).child(div().max_w(110).truncate().text_size(11).text_color(mine ? t.accent : t.dim).when(mine, (el) => el.font_semibold()).child(who))))));
    if (!nested) return card.w_full().flex_none();
    return div().flex().flex_row().items_stretch().w_full().flex_none()
      .child(this.boardGuides(t, x.guides)).child(card.flex_1().min_w(0));
  }

  boardGuides(t, guides) {
    const col = (g) => {
      const c = div().relative().w(BOARD_STEP).flex_none();
      const line = (el) => el.child(div().absolute().left(BOARD_X).top(-6).bottom(-6).w(1).bg(t.border));
      if (g === "line") return line(c);
      if (g === "mid" || g === "end") {
        return (g === "mid" ? line(c) : c).child(div().absolute().left(BOARD_X).top(-6).h(25).w(BOARD_STEP - BOARD_X)
          .border_l(1).border_b(1).rounded_bl(6).border_color(t.border));
      }
      return c;
    };
    return div().flex().flex_row().items_stretch().flex_none().children(guides.map(col));
  }

  row(t, r, on, index, n) {
    if (r.kind === "head") return div().px(14).pt(10).pb(3).text_size(11).font_semibold().text_color(t.dim).child(r.text);
    const base = (id) => h_flex().id(id).mx(6).px(8).h(30).gap(8).items_center().rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
      .on_mouse_down("left", stop)
      .on_click((e, cx) => {
        this.focusList();
        if (on || e.click_count === 2) this.activate(r, cx);
        else { this.sel = index; this.schedulePreview(cx); cx.notify(); }
      });
    if (r.kind === "more") return base("l-more").mt(4).text_color(t.muted).child(this.loading.has("all") || this.loading.has(this.tab) ? T().loading : T().more);
    const i = r.issue;
    const link = this.links?.[i.identifier];
    const pr = api.mainPr(i);
    // The list's own width: beside the preview it's the left panel, else the window.
    const w = this.width >= WIDE && this.layout === "split" && this.mode === "list" ? this.listW : this.width;
    const nest = this.nest && r.depth !== undefined;
    // Done and canceled issues fade, so open work stands out.
    const closed = CLOSED.has(i.state?.type);
    const labels = (i.labels?.nodes ?? []).slice(0, 2);
    const mine = this.assignedToMe(i);
    return base(`l-${i.identifier}-${n}`).relative()
      .when(mine, (el) => el.child(div().absolute().left(0).top(7).bottom(7).w(3).rounded(2).bg(t.accent)))
      .when(nest && r.depth > 0, (el) => el.child(this.treeGuides(t, r.guides)))
      .child(h_flex().flex_1().min_w(0).h_full().gap(8).items_center().when(closed, (el) => el.opacity(0.45))
        .child(this.prioIcon(t, i.priority))
        .child(h_flex().w(76).flex_none().child(div().id(`l-id-${i.identifier}-${n}`).text_size(11.5).text_color(t.dim).truncate().cursor_pointer()
          .hover((s) => s.text_color(t.accent)).on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.copy(i.identifier, "ID", cx); }).child(i.identifier)))
        .child(svg(stateIcon(i.state)).size(14).flex_none().text_color(i.state?.color ?? t.dim))
        .when(Boolean(i.parent) && !(nest && r.depth > 0), (el) => el.child(h_flex().flex_none().gap(3).text_size(10.5).text_color(t.dim)
          .child("↳").child(i.parent.identifier)))
        .child(div().flex_1().min_w(0).truncate().text_color(closed ? t.muted : t.foreground).when(closed, (el) => el.line_through()).child(i.title))
        .when(Boolean(r.progress), (el) => el.child(this.progressPill(t, r, `lpg-${i.identifier}-${n}`)))
        .when(Boolean(r.pin), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(T().currentBranch)))
        .when(Boolean(pr), (el) => el.child(this.prBadge(t, pr, `lp-${i.identifier}-${n}`)))
        .when(Boolean(link), (el) => el.child(this.agentBadge(t, link, `lb-${i.identifier}-${n}`)))
        // The list alone has room for more: labels and project, state, assignee, last update.
        .when(w >= 980 && labels.length > 0, (el) => el.child(h_flex().flex_none().gap(4).children(labels.map((l) =>
          h_flex().h(18).px(6).gap(4).items_center().rounded(9).border_1().border_color(t.border).text_size(10.5).text_color(t.muted)
            .child(div().size(6).rounded(3).bg(l.color ?? t.dim)).child(div().max_w(90).truncate().child(l.name))))))
        .when(w >= 980, (el) => el.child(div().w(120).flex_none().truncate().text_size(11).text_color(t.dim).child(i.project?.name ?? "")))
        .when(w >= 760, (el) => el.child(div().w(96).flex_none().truncate().text_size(11).text_color(t.muted).child(i.state?.name ?? "")))
        .when(w >= 400, (el) =>
          el.child(div().w(w >= 760 ? 96 : 72).flex_none().truncate().text_size(11).text_color(mine ? t.accent : t.dim).when(mine, (el) => el.font_semibold())
            .child(i.assignee?.displayName ?? i.assignee?.name ?? "")))
        .when(w >= 760, (el) => el.child(div().w(56).flex_none().text_size(11).text_color(t.dim).child(ago(i.updatedAt)))));
  }

  // Tree lines left of a sub-issue: a column per level, the line under the parent's priority icon,
  // a rounded elbow into the row on its own level. Rows touch (30 px, no gap), so the lines join.
  treeGuides(t, guides) {
    // The row's 8 px gap follows the last column, so it's that much narrower: level d's icon starts d steps in.
    const col = (g, n) => {
      const c = div().relative().w(n === guides.length - 1 ? TREE_STEP - 8 : TREE_STEP).h_full().flex_none();
      const line = (el) => el.child(div().absolute().left(TREE_X).top(0).bottom(0).w(1).bg(t.border));
      if (g === "line") return line(c);
      if (g === "mid" || g === "end") {
        return (g === "mid" ? line(c) : c).child(div().absolute().left(TREE_X).top(0).h(15).w(TREE_STEP - TREE_X - 3)
          .border_l(1).border_b(1).rounded_bl(6).border_color(t.border));
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
      .when(Boolean(words), (el) => el.child(div().text_color(t.muted).child(words)))
      .when(big, (el) => el.child(div().text_color(t.dim).child("Y")));
  }

  // The agent in the issue's tab. Clicking goes to that tab.
  agentBadge(t, link, id, big = false) {
    const st = link.tab.status, a = T().agent, prog = link.program;
    const color = st === "working" ? t.working : st === "blocked" ? t.blocked : st === "done" ? t.done : t.dim;
    const label = st === "working" ? elapsed(Date.now() - (link.tab.working_since ?? Date.now()))
      : st === "blocked" ? a.blocked : link.watching ? a.watching[link.watching] : st === "done" ? a.done : big ? a.idle : a.tab;
    const icon = prog?.key === "claude" || link.watching
      ? svg(prog?.icon ?? CLAUDE_ICON).size(big ? 14 : 12).text_color(prog?.color ?? CLAUDE)
      : prog?.icon ? svg(prog.icon).size(big ? 13 : 11).text_color(prog.color ?? color)
      : svg(`${ICON}/terminal.svg`).size(big ? 13 : 11).text_color(color);
    return h_flex().id(id).flex_none().h(big ? 24 : 20).px(big ? 8 : 6).gap(5).items_center().rounded(5).cursor_pointer()
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
        return TextView.markdown(`${key}-${n}`, part.text).selectable().on_link_click((url, cx) => this.openUrl(url, cx));
      }
      const img = this.image(part.url);
      // An upload link whose file isn't an image (a PDF, a video): the link it was.
      if (part.link && img?.state === "error" && /type/.test(img.why ?? "")) {
        return TextView.markdown(`${key}-${n}`, part.src).selectable().on_link_click((url, cx) => this.openUrl(url, cx));
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
  outlineView(t, id, secs, thr, S, onScreen, w) {
    const tr = T();
    const heads = secs.filter((s) => s.title);
    const minL = Math.min(...heads.map((s) => s.level), 3);
    const ROW = 26, GAP = 1, PAD = 12;
    const item = (key, el, indent = 0) => {
      const on = key === S.active, seen = onScreen.has(key);
      return h_flex().id(`ol-${key}`).h(ROW).flex_none().pl(8 + indent).pr(8).gap(6).items_center().rounded(6).min_w(0)
        .text_size(12).text_color(on || seen ? t.foreground : t.dim).cursor_pointer()
        .border_r(2).border_color(on ? t.accent : seen ? t.border : "#00000000").when(on, (e) => e.bg(t.hover).font_semibold())
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click((_e, cx) => this.jump(id, key, cx)).child(el);
    };
    const group = (key, label, count) => item(key, h_flex().flex_1().min_w(0).gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(11).font_semibold().text_color(t.dim).child(label))
      .when(count !== undefined, (e) => e.child(div().text_size(11).text_color(t.dim).child(String(count)))));
    const short = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getMonth() + 1}/${d.getDate()}`; };
    const rows = [group("top", tr.body), ...heads.map((s) => item(s.key, div().flex_1().min_w(0).truncate().child(s.title), (s.level - minL) * 12))];
    if (thr) {
      rows.push(group("cmts", tr.commentsTitle, thr.reduce((n, x) => n + 1 + x.replies.length, 0)));
      for (const x of thr) {
        const c = x.comment, name = c.user?.displayName ?? c.user?.name ?? tr.unknownUser;
        rows.push(item(`c:${c.id}`, h_flex().flex_1().min_w(0).gap(6).items_center()
          .child(this.avatar(t, name, 16))
          .child(div().flex_1().min_w(0).truncate().child(name))
          .when(x.replies.length > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(`↳${x.replies.length}`)))
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(short(c.createdAt)))));
      }
    }
    // Follow: when the marked item changes, bring its row into the middle third.
    const total = PAD * 2 + rows.length * (ROW + GAP);
    const olMax = Math.max(0, total - S.olView);
    const ai = S.keys.indexOf(S.active);
    if (S.olFollow !== S.active && ai >= 0 && S.olView > 0) {
      const top = PAD + ai * (ROW + GAP);
      if (top < S.ol + S.olView / 3 || top + ROW > S.ol + (S.olView * 2) / 3) S.ol = top - S.olView / 3;
      S.olFollow = S.active;
    }
    S.ol = Math.max(0, Math.min(olMax, S.ol));
    return v_flex().id(`ol-${id}`).w(w).flex_none().h_full().min_h(0).overflow_hidden().border_l(1).border_color(t.border)
      .on_size_change((size, cx) => { if (Math.abs(size.height - S.olView) > 0.5) { S.olView = size.height; cx.notify(); } })
      .on_scroll_wheel((e, cx) => { cx.stop_propagation(); const y = Math.max(0, Math.min(olMax, S.ol - e.delta.y)); if (y !== S.ol) { S.ol = y; cx.notify(); } })
      .child(v_flex().flex_none().w_full().mt(-S.ol).py(PAD).px(8).gap(GAP).children(rows));
  }

  detailView(t, id, full) {
    const tr = T();
    const d = this.details[id];
    const issue = d?.issue ?? this.cache[id];
    if (!issue) return this.empty(t, this.loading.has(`d:${id}`) ? tr.loading : `${id}`);
    const pr = api.mainPr(issue);
    const hist = { ...tr.hist, priorityName: { 0: tr.noPriority, ...tr.priority } };
    const author = d ? createdBy(d.issue, d.history) : null;
    const entries = d ? historyEntries(d.issue, d.history, hist) : [];
    const meta = [
      issue.createdAt && `${author ? hist.createdBy(author) : hist.createdAt} ${ago(issue.createdAt)}`,
      issue.assignee && `${tr.assignee} ${issue.assignee.displayName ?? issue.assignee.name}`,
      issue.project && `${tr.project} ${issue.project.name}`,
      issue.cycle && `${tr.cycle} ${issue.cycle.name ?? issue.cycle.number}`,
      issue.dueDate && `${tr.due} ${issue.dueDate}`,
      `${tr.updated} ${ago(issue.updatedAt)}`,
    ].filter(Boolean).join("  ·  ");

    const rel = d?.relations;
    const link = this.links?.[issue.identifier];
    const paneW = full || this.width < WIDE ? this.width : this.width - this.listW;
    const secs = Doc.sections(issue.description ?? "");
    const thr = d ? Doc.threads(d.comments) : null;
    const tocW = 200;
    const editing = this.issueEdit?.id === id;
    const showToc = !editing && paneW >= 640 && (secs.some((s) => s.title) || (thr?.length ?? 0) > 0);
    const maxW = Math.max(160, paneW - 40 - (showToc ? tocW : 0));
    const relRow = (x, n, kind) => h_flex().id(`rel-${kind}-${x.id}-${n}`).h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.openDetail(x.identifier, cx, !full))
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
    const agent = this.agentName();

    const head = () => v_flex().gap(14)
      .child(h_flex().gap(8).items_center().flex_wrap()
        .when(full, (el) => el.child(this.button(t, "d-back", tr.back, (cx) => this.back(cx))))
        .child(div().id("d-ident").text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => this.copy(issue.identifier, "ID", cx)).child(issue.identifier))
        .child(h_flex().id(`d-state-${id}`).h(22).px(8).gap(6).items_center().rounded(11).border_1().text_size(11.5)
          .border_color(this.statePick?.id === id ? t.accent : t.border)
          .when(this.canWrite, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
            .on_click((_e, cx) => (this.statePick?.id === id ? (this.statePick = null, cx.notify()) : this.openStates(id, cx))))
          .child(svg(stateIcon(issue.state)).size(13).text_color(issue.state?.color ?? t.dim)).child(issue.state?.name ?? "?")
          .when(this.canWrite, (el) => el.child(div().text_size(10).text_color(t.dim).child("s"))))
        .child(h_flex().id(`d-assignee-${id}`).h(22).pl(3).pr(8).gap(6).items_center().rounded(11).border_1().text_size(11.5)
          .border_color(this.assignPick?.id === id ? t.accent : t.border)
          .when(this.canWrite, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
            .on_click((_e, cx) => this.openAssign(id, cx)))
          .child(issue.assignee ? this.avatar(t, issue.assignee.name, 16) : svg(`${ICON}/person.svg`).size(13).text_color(t.dim))
          .child(div().text_color(issue.assignee ? (this.assignedToMe(issue) ? t.accent : t.foreground) : t.dim)
            .child(issue.assignee ? issue.assignee.displayName ?? issue.assignee.name : tr.unassigned))
          .when(this.canWrite, (el) => el.child(div().text_size(10).text_color(t.dim).child("⇧A"))))
        .when(Boolean(tr.priority[issue.priority]), (el) => el.child(h_flex().gap(5).items_center().text_size(11.5).text_color(issue.priority === 1 ? URGENT : t.muted)
          .child(this.prioIcon(t, issue.priority)).child(tr.priority[issue.priority])))
        .child(div().text_size(11.5).text_color(t.dim).child(issue.team?.name ?? "")))
      .child(editing
        ? h_flex().id(`e-title-${id}`).h(38).px(10).items_center().rounded(8).border_1().bg(t.background)
          .border_color(this.editFocus === "title" ? t.accent : t.border).on_mouse_down("left", stop)
          .child(Input.new(this.titleInput).flex_1().h_full().text_size(17))
        : TextView.markdown(`d-title-${id}`, `## ${issue.title.replace(/[\\`*_[\]#]/g, "\\$&")}`).selectable())
      .child(div().text_size(11.5).text_color(t.muted).child(meta))
      .when(this.statePick?.id === id, (el) => el.child(this.statePicker(t)))
      .when(this.assignPick?.id === id, (el) => el.child(this.assignPicker(t)))
      .when(Boolean(issue.labels?.nodes?.length), (el) => el.child(h_flex().gap(6).flex_wrap().items_center()
        .children(issue.labels.nodes.map((l) => this.chip(t, l.color, l.name)))))
      .when(Boolean(link), (el) => el.child(h_flex().gap(10).p(10).items_center().rounded(8).bg(t.surface).border_1().border_color(t.border)
        .child(this.agentBadge(t, link, `db-${id}`, true))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(tr.tabIn(link.space.name, link.tab.name)))
        .child(this.button(t, "d-go", tr.goTab, () => this.goTab(link), true))))
      .child(h_flex().gap(6).flex_wrap()
        .child(this.button(t, "d-work", link ? tr.newAgentTab(agent) : tr.workWith(agent), (cx) => this.work(issue, cx), !link))
        .child(this.button(t, "d-ask", tr.askAgent(agent), (cx) => this.askClaude(issue, cx)))
        .when(this.canWrite && !editing, (el) => el.child(this.button(t, "d-edit", tr.editIssue, (cx) => this.editIssue(id, cx))))
        .when(this.canWrite && issue.assignee?.id !== this.viewer?.id, (el) => el.child(this.button(t, "d-assign", tr.assignMe, (cx) => this.assignMe(issue, cx))))
        .when(!this.canWrite, (el) => el.child(this.button(t, "d-connect", this.connecting ? tr.connecting : tr.connectLinear, (cx) => this.connect(cx))))
        .child(this.button(t, "d-open", tr.browser, (cx) => this.openUrl(issue.url, cx)))
        .child(this.button(t, "d-url", tr.copyUrl, (cx) => this.copy(issue.url, "URL", cx)))
        .child(this.button(t, "d-id", tr.copyId, (cx) => this.copy(issue.identifier, "ID", cx)))
        .when(Boolean(issue.description?.trim()), (el) => el.child(this.button(t, "d-body-copy", tr.copyBody, (cx) => this.copy(issue.description, tr.bodyWord, cx))))
        .when(Boolean(pr), (el) => el.child(this.prBadge(t, pr, "d-pr", true))))
      .when(groups.length > 0, (el) => el.child(v_flex().gap(10).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border).children(groups)));

    const divider = (label) => h_flex().gap(10).items_center().pt(6).text_size(11.5).font_semibold().text_color(t.dim)
      .child(div().child(label)).child(div().flex_1().h(1).bg(t.border));

    // The view's items, in order. The outline points at them by key.
    const items = [{ key: "top", el: () => v_flex().gap(14).child(head()).child(divider(tr.body)) }];
    if (editing) items.push({ key: "edit", el: () => this.issueEditor(t, id, maxW) });
    else if (!secs.length) items.push({ key: "nobody", el: () => div().text_size(12).text_color(t.dim).child(tr.noBody) });
    if (!editing) for (const s of secs) items.push({ key: s.key, el: () => this.markdown(t, `d-body-${id}-${s.key}`, s.text, maxW) });
    if (d) {
      const bar = this.reactionsBar(t, d.issue.reactionData, "issue");
      if (bar) items.push({ key: "ireact", el: () => bar });
    }
    if (entries.length) {
      items.push({ key: "hist", el: () => v_flex().gap(6).child(divider(`${hist.title} ${entries.length}`))
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

    // Where each item is (from the heights measured last frame), which outline item is at the top,
    // and which are on screen.
    const S = this.scrollOf(id);
    const GAP = 14, PAD = 16;
    let y = PAD;
    for (const i of items) { S.tops[i.key] = y; y += (S.h[i.key] ?? 0) + GAP; }
    S.y = Math.max(0, Math.min(this.maxScroll(S), S.y));
    S.keys = ["top", ...secs.filter((s) => s.title).map((s) => s.key), ...(thr ? ["cmts", ...thr.map((x) => `c:${x.comment.id}`)] : [])];
    const reach = S.y + 24;
    S.active = S.keys.reduce((a, k) => ((S.tops[k] ?? Infinity) <= reach ? k : a), "top");
    // At the very bottom the last items can't reach the top; mark the last one that's on screen.
    const onScreen = new Set();
    const order = items.map((i) => i.key);
    for (let n = 0; n < order.length; n++) {
      const top = S.tops[order[n]], bottom = top + (S.h[order[n]] ?? 0);
      if (bottom >= S.y && top <= S.y + S.view) onScreen.add(order[n]);
    }
    // Items between two outline keys belong to the one before (a section's text to its heading).
    const owner = {};
    let cur = "top";
    for (const k of order) { if (S.keys.includes(k)) cur = k; owner[k] = cur; }
    const seen = new Set([...onScreen].map((k) => owner[k]));
    if (S.view > 0 && S.y >= this.maxScroll(S) - 2 && S.y > 0) {
      const last = S.keys.filter((k) => seen.has(k)).pop();
      if (last) S.active = last;
    }

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
    return v_flex().flex_1().w_full().min_h(0).on_mouse_down("left", (_e, cx) => { this.hold(cx); cx.stop_propagation(); })
      .child(h_flex().flex_1().w_full().min_h(0).items_start()
        .child(page)
        .when(showToc, (el) => el.child(this.outlineView(t, id, secs, thr, S, seen, tocW))))
      .child(this.canWrite ? this.composerBar(t, issue, id) : this.commentBar(t, issue));
  }

  issueEditor(t, id, maxW) {
    const tr = T(), changed = this.issueEdited();
    return v_flex().gap(10).w_full()
      .child(div().id(`e-body-${id}`).w_full().min_w(0).rounded(8).border_1().bg(t.background)
        .border_color(this.editFocus === "body" ? t.accent : t.border).on_mouse_down("left", stop)
        .child(Textarea.new(this.bodyDraft).w_full()))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(11).text_color(t.dim).child(tr.editHint))
        .child(this.button(t, "e-cancel", tr.cancel, (cx) => this.cancelEdit(cx)))
        .child(this.button(t, "e-save", this.sending ? tr.saving : tr.save, (cx) => this.saveIssue(cx), changed && !this.sending)))
      .child(div().pt(4).text_size(11).font_semibold().text_color(t.dim).child(tr.preview))
      .child(v_flex().w_full().p(12).rounded(8).border_1().border_color(t.border)
        .child(this.markdown(t, `e-prev-${id}`, this.bodyDraft.value().trim() || `_${tr.noBody}_`, maxW - 26)));
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
    const hint = this.editFocus ? T().editHint : this.composing ? T().commentHint(this.agentName()) : this.mode === "detail" ? (this.canWrite ? T().hintDetailWrite : T().hintDetail)(this.agentName()) : this.typing ? T().hintSearch : this.layout === "board" ? T().hintBoard : T().hintList;
    return h_flex().h(26).flex_none().px(12).gap(10).items_center().border_t(1).border_color(t.border).text_size(11)
      .child(div().flex_1().min_w(0).truncate().text_color(s ? (s.level === "error" ? t.blocked : s.level === "success" ? t.done : t.muted) : t.dim).child(s?.text ?? hint))
      .child(div().flex_none().text_color(t.dim).child(this.viewer ? `${this.viewer.displayName ?? this.viewer.name} · ${T().teams} ${(this.viewer.teams?.nodes ?? []).map((x) => x.key).join(" ")}` : ""));
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
