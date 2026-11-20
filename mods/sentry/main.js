import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView } from "gpui-base";
import { theme, props, closeOverlay, run, spaces, panes, focused, exec, appHome, home, nextCommand } from "herdr";
import * as fs from "fs/promises";
import { TABS, PERIODS, SORTS, target, shortIdIn, queryFor, ago, count } from "./sentry.js";

const BASE = "mods/sentry";
const ICON = `${BASE}/icons`;
const CACHE = () => `${appHome()}/${BASE}/.cache`;
const DATA = () => `${CACHE()}/data.json`;
const CLI = () => `${appHome()}/${BASE}/cli/sentry-me.mjs`;
const TAB_LABEL = { mine: "Mine", team: "Team", all: "All unresolved" };
const SORT_LABEL = { date: "last seen", freq: "events", new: "first seen", user: "users" };
const LEVEL = { fatal: "#c4314b", error: "#e5484d", warning: "#f5a524", info: "#3b82f6", debug: "#8b8d98" };
const SUBSTATUS = { new: "new", regressed: "regressed", escalating: "escalating" };
const DAY = 86400000;
const stop = (_e, cx) => cx.stop_propagation();

export default class Sentry extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.config = { org: "", team: "", environment: "", repo: "", agent: ["claude"], skill: "" };
    this.input = InputState.new({ placeholder: "Search, or paste an issue id or link and press Enter" });
    this.input.on("change", (_e, cx) => cx.notify());
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.tab = "mine";
    this.period = "24h";
    this.sort = "date";
    this.query = "";
    this.lists = {};
    this.sel = 0;
    this.detail = null;
    this.loading = new Set();
    this.status = null;
    this.connected = null;
    this.data = {};
    cx.spawn(async (cx) => {
      await this.loadConfig();
      await this.readData();
      this.lists = this.data.lists ?? {};
      if (this.data.prefs?.period && PERIODS.includes(this.data.prefs.period)) this.period = this.data.prefs.period;
      if (this.data.prefs?.sort && SORTS.includes(this.data.prefs.sort)) this.sort = this.data.prefs.sort;
      if (this.data.prefs?.tab && TABS.includes(this.data.prefs.tab)) this.tab = this.data.prefs.tab;
      this.connected = await this.isConnected();
      cx.notify();
      if (!this.connected) return;
      await this.ensureOrg(cx);
      if (props()?.open === "current") await this.openCurrent(cx);
      await this.load(cx);
      this.loadProjects(cx);
    });
    cx.timer.after(300, () => { if (!this.typing) this.handle.focus(); });
    this.focusUntil = Date.now() + 2000;
    cx.timer.every(250, () => this.keepFocus());
    cx.spawn(async (cx) => {
      let burst = 0, since = Date.now();
      for (;;) {
        let c;
        try { c = await nextCommand(); } catch { return; }
        if (c === undefined || c === null || c === "") return;
        if (Date.now() - since > 1000) { burst = 0; since = Date.now(); }
        if (++burst > 50) return;
        const [name, arg] = String(c).split(/[:\s]+/, 2);
        if (name === "refresh") this.reload(cx);
        else if (name === "close") this.dismiss();
        else if (name === "search") { this.input.focus(); }
        else if (name === "open" && arg) this.open(target(arg, this.org?.webUrl) ?? { issueId: arg }, cx);
      }
    });
  }

  keepFocus() {
    if (props()?.overlay || this.typing) return;
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const was = this.lastPane;
    this.lastPane = pane?.pane ?? null;
    if (this.handle.is_focused()) {
      if (pane?.mod === "sentry") this.myPane = pane.pane;
      return;
    }
    const all = panes().filter((p) => p.mod === "sentry");
    const own = this.myPane ?? (all.length === 1 ? all[0].pane : null);
    if (own && pane?.pane === own && was !== own) this.focusUntil = Date.now() + 1500;
    const target = own ?? (pane?.mod === "sentry" ? pane.pane : null);
    if (target && pane?.pane === target && Date.now() < (this.focusUntil ?? 0)) this.handle.focus();
  }

  async loadConfig() {
    try { Object.assign(this.config, JSON.parse(await fs.readFile(`${appHome()}/${BASE}/config.json`, "utf8"))); } catch {}
  }

  async readData() {
    try { this.data = JSON.parse(await fs.readFile(DATA(), "utf8")) ?? {}; } catch { this.data = {}; }
  }

  async writeData(patch) {
    Object.assign(this.data, patch);
    const tmp = `${DATA()}.${Date.now()}.tmp`;
    try {
      await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", CACHE()]);
      await fs.writeFile(tmp, JSON.stringify(this.data));
      await exec("mv", ["-f", tmp, DATA()]);
    } catch {
      await exec("rm", ["-f", tmp]).catch(() => {});
    }
  }

  async isConnected() {
    const r = await exec("node", [CLI(), "status"]).catch(() => null);
    try { return JSON.parse(r?.stdout ?? "").connected === true; } catch { return false; }
  }

  async sentry(tool, args) {
    const file = `${CACHE()}/call-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    let r;
    try {
      await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", CACHE()]);
      await fs.writeFile(file, JSON.stringify(args));
      r = await exec("node", [CLI(), "call", tool, `@${file}`], { timeout: 90000 });
    } finally {
      await exec("rm", ["-f", file]).catch(() => {});
    }
    let out = null;
    try { out = JSON.parse(String(r.stdout).trim().split("\n").pop()); } catch {}
    if (!out?.ok) throw new Error(out?.error ?? (r.stderr || r.stdout || "sentry-me failed").trim());
    return out.value;
  }

  where() { return { organizationSlug: this.org.slug, regionUrl: this.org.regionUrl }; }

  async ensureOrg(cx) {
    this.org = this.data.org ?? null;
    this.me = this.data.me ?? null;
    if (this.org && (!this.config.org || this.org.slug === this.config.org) && this.me) return;
    await this.call(cx, "org", async () => {
      const orgs = (await this.sentry("find_organizations", {}))?.organizations ?? [];
      this.org = orgs.find((o) => o.slug === this.config.org) ?? orgs[0] ?? null;
      this.me = (await this.sentry("whoami", {}))?.user ?? null;
      await this.writeData({ org: this.org, me: this.me });
    });
  }

  async loadProjects(cx) {
    if (!this.org || (this.data.projects?.length && Date.now() - (this.data.projectsAt ?? 0) < DAY)) return;
    const slugs = [];
    let cursor = null;
    for (let page = 0; page < 20; page++) {
      const v = await this.sentry("find_projects", { ...this.where(), ...(cursor ? { cursor } : {}) }).catch(() => null);
      if (!v) return;
      slugs.push(...(v.projects ?? []).map((p) => p.slug).filter(Boolean));
      if (!v.hasMore || !v.nextCursor) break;
      cursor = v.nextCursor;
    }
    await this.writeData({ projects: slugs, projectsAt: Date.now() });
    cx.notify();
  }

  async call(cx, label, fn) {
    this.loading.add(label);
    cx.notify();
    try {
      const r = await fn();
      if (this.status?.level === "error") this.status = null;
      return r;
    } catch (e) {
      this.say(String(e?.message ?? e), cx, "error");
      return undefined;
    } finally {
      this.loading.delete(label);
      cx.notify();
    }
  }

  say(text, cx, level = "info") {
    this.status = { text, level };
    cx.notify();
    if (level !== "error") cx.timer.after(4000, (cx) => { if (this.status?.text === text) { this.status = null; cx.notify(); } });
  }

  tabs() { return TABS.filter((x) => x !== "team" || this.config.team); }
  listKey() { return `${this.tab}|${this.period}|${this.sort}|${this.query}`; }
  issues() { return this.lists[this.listKey()] ?? []; }

  async load(cx) {
    if (!this.org) return;
    const key = this.listKey();
    const v = await this.call(cx, key, () => this.sentry("search_issues", {
      ...this.where(), query: queryFor(this.tab, this.config, this.query), sort: this.sort, period: this.period, limit: 50,
    }));
    if (!v) return;
    this.lists[key] = v.issues ?? [];
    if (key === this.listKey()) this.sel = Math.min(this.sel, Math.max(0, this.lists[key].length - 1));
    const keep = Object.fromEntries(Object.entries(this.lists).filter(([k]) => !k.split("|")[3]));
    this.writeData({ lists: keep });
    cx.notify();
  }

  reload(cx) {
    this.say("Refreshing…", cx);
    cx.spawn(async (cx) => {
      await this.load(cx);
      if (this.detail) await this.openIssue(this.detail.target, cx, true);
      this.say("Up to date", cx, "success");
    });
  }

  savePrefs() { this.writeData({ prefs: { tab: this.tab, period: this.period, sort: this.sort } }); }

  setTab(tab, cx) {
    if (!this.tabs().includes(tab)) return;
    this.tab = tab;
    this.sel = 0;
    this.detail = null;
    this.savePrefs();
    cx.notify();
    cx.spawn(async (cx) => this.load(cx));
  }

  cycle(kind, cx) {
    if (kind === "period") this.period = PERIODS[(PERIODS.indexOf(this.period) + 1) % PERIODS.length];
    else this.sort = SORTS[(SORTS.indexOf(this.sort) + 1) % SORTS.length];
    this.sel = 0;
    this.savePrefs();
    cx.notify();
    cx.spawn(async (cx) => this.load(cx));
  }

  submit(cx) {
    const text = this.input.value().trim();
    const t = target(text, this.org?.webUrl);
    if (t) {
      this.handle.focus();
      this.open(t, cx);
      return;
    }
    this.query = text;
    this.sel = 0;
    this.detail = null;
    this.handle.focus();
    cx.notify();
    cx.spawn(async (cx) => this.load(cx));
  }

  async openCurrent(cx) {
    const texts = props()?.texts ?? [];
    let id = shortIdIn(texts, this.data.projects ?? []);
    if (!id && !this.data.projects?.length) {
      await this.loadProjects(cx);
      id = shortIdIn(texts, this.data.projects ?? []);
    }
    if (id) await this.openIssue({ issueId: id }, cx);
    else this.say(`No Sentry issue in ${texts.filter(Boolean).join(", ") || "this place"}: here are your issues`, cx);
  }

  async openIssue(t, cx, quiet = false) {
    if (!this.org || !t) return;
    const label = t.issueId ?? t.issueUrl;
    if (!quiet) { this.detail = { target: t, label, md: null, issue: null }; cx.notify(); }
    const md = await this.call(cx, `issue:${label}`, () => this.sentry("get_issue_details", { ...this.where(), ...t }));
    if (md === undefined) { if (!quiet) this.detail = null; cx.notify(); return; }
    const text = typeof md === "string" ? md : JSON.stringify(md, null, 2);
    const shortId = text.match(/^# Issue (\S+)/m)?.[1] ?? t.issueId ?? null;
    const url = text.match(/\*\*URL\*\*: (\S+)/)?.[1] ?? t.issueUrl ?? null;
    const known = this.issues().find((x) => x.shortId === shortId) ?? null;
    const field = (name) => text.match(new RegExp(`\\*\\*${name}\\*\\*: (.+)`))?.[1]?.trim() ?? null;
    this.detail = {
      target: t, label: shortId ?? label, md: text, shortId, url,
      issue: known ?? { shortId, url, title: field("Description"), status: field("Status"), substatus: field("Substatus"), projectSlug: field("Project") },
    };
    cx.notify();
  }

  open(t, cx) {
    if (!t) return;
    cx.spawn(async (cx) => this.openIssue(t, cx));
  }

  back(cx) {
    if (this.detail) { this.detail = null; this.handle.focus(); cx.notify(); return; }
    this.dismiss();
  }

  dismiss() {
    const o = props()?.overlay;
    if (o) closeOverlay(o);
  }

  selected() { return this.detail?.issue ?? this.issues()[this.sel] ?? null; }

  copy(text, cx) {
    if (!text) return;
    cx.write_to_clipboard(text);
    this.say(`Copied ${text}`, cx, "success");
  }

  openUrl(url, cx) { if (/^https?:/.test(url ?? "")) cx.open_url(url); }

  update(issue, change, done, cx) {
    if (!issue?.shortId) return;
    cx.spawn(async (cx) => {
      const ok = await this.call(cx, `update:${issue.shortId}`, () => this.sentry("update_issue", { ...this.where(), issueId: issue.shortId, ...change }));
      if (ok === undefined) return;
      this.say(done, cx, "success");
      await this.load(cx);
      if (this.detail?.shortId === issue.shortId) await this.openIssue(this.detail.target, cx, true);
    });
  }

  resolve(issue, cx) { this.update(issue, { status: "resolved" }, `${issue?.shortId} resolved`, cx); }
  ignore(issue, cx) { this.update(issue, { status: "ignored", ignoreMode: "untilEscalating" }, `${issue?.shortId} ignored until it escalates`, cx); }
  assignMe(issue, cx) {
    if (!this.me?.id) { this.say("Couldn't find your Sentry user", cx, "error"); return; }
    this.update(issue, { assignedTo: `user:${this.me.id}` }, `${issue?.shortId} assigned to you`, cx);
  }

  work(issue, cx) {
    if (!issue?.shortId) return;
    const repo = String(this.config.repo || "").replace(/^~(?=\/|$)/, home());
    const url = issue.url ?? `${this.org.webUrl}/issues/${issue.shortId}/`;
    const task = this.config.skill
      ? `Use the ${this.config.skill} skill. There is no Linear issue yet: investigate Sentry issue ${issue.shortId} (${url}) with the Sentry tools, open the Linear issue for it, and go on with the same flow. This tab is named ${issue.shortId}: when you rename it, keep that id after the Linear one ("<ID> · ${issue.shortId}").`
      : `Look into Sentry issue ${issue.shortId}: ${issue.title ?? ""}\n${url}`;
    const space = (repo && spaces().find((s) => s.folder === repo && !s.machine)) || spaces().find((s) => s.active);
    if (space) {
      run("tab.new", { space: space.id, folder: repo || undefined, name: issue.shortId, argv: this.config.agent, task });
      run("space.select", { id: space.id });
    } else {
      run("space.new", { folder: repo || home(), tab: issue.shortId, argv: this.config.agent, task });
    }
    this.dismiss();
  }

  connect(cx) {
    if (this.connecting) return;
    this.connecting = true;
    this.say("Opening Sentry in your browser…", cx);
    cx.spawn(async (cx) => {
      await exec("node", [CLI(), "login"], { timeout: 330000 }).catch(() => null);
      this.connecting = false;
      this.connected = await this.isConnected();
      if (!this.connected) { this.say("Couldn't connect Sentry", cx, "error"); return; }
      this.say("Sentry is connected", cx, "success");
      await this.ensureOrg(cx);
      await this.load(cx);
      this.loadProjects(cx);
    });
  }

  onKey(e, cx) {
    const k = e.keystroke.replace(/(^|-)fn-/, "$1");
    if (k === "cmd-r") { this.reload(cx); cx.stop_propagation(); return; }
    if (this.typing) {
      if (k === "escape") { this.handle.focus(); cx.stop_propagation(); }
      else if (k === "down") { this.handle.focus(); cx.stop_propagation(); }
      return;
    }
    const list = this.issues();
    const issue = this.selected();
    const keys = this.detail ? {
      escape: () => this.back(cx), backspace: () => this.back(cx), q: () => this.dismiss(),
      o: () => this.openUrl(this.detail.url, cx), y: () => this.copy(this.detail.url, cx), i: () => this.copy(this.detail.shortId, cx),
      "shift-r": () => this.resolve(issue, cx), "shift-i": () => this.ignore(issue, cx), a: () => this.assignMe(issue, cx), c: () => this.work(issue, cx),
      r: () => this.reload(cx),
    } : {
      escape: () => (this.query ? (this.query = "", this.input.set_value(""), this.load(cx)) : this.dismiss()), q: () => this.dismiss(),
      down: () => { this.sel = Math.min(list.length - 1, this.sel + 1); cx.notify(); },
      up: () => { this.sel = Math.max(0, this.sel - 1); cx.notify(); },
      enter: () => issue && this.open({ issueId: issue.shortId }, cx),
      "/": () => this.input.focus(), "cmd-f": () => this.input.focus(),
      1: () => this.setTab(this.tabs()[0], cx), 2: () => this.setTab(this.tabs()[1], cx), 3: () => this.setTab(this.tabs()[2], cx),
      tab: () => this.setTab(this.tabs()[(this.tabs().indexOf(this.tab) + 1) % this.tabs().length], cx),
      p: () => this.cycle("period", cx), f: () => this.cycle("sort", cx), r: () => this.reload(cx),
      o: () => this.openUrl(issue?.url, cx), y: () => this.copy(issue?.url, cx), i: () => this.copy(issue?.shortId, cx),
      "shift-r": () => this.resolve(issue, cx), "shift-i": () => this.ignore(issue, cx), a: () => this.assignMe(issue, cx), c: () => this.work(issue, cx),
    };
    if (!keys[k]) return;
    keys[k]();
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    const root = v_flex().id("sentry-root").size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", () => { if (!this.typing) this.handle.focus(); });
    if (this.connected === false) return root.child(this.header(t)).child(this.connectView(t)).child(this.footer(t));
    return root.child(this.header(t))
      .child(this.detail ? this.detailView(t) : this.listView(t))
      .child(this.footer(t));
  }

  button(t, id, label, action, enabled = true) {
    return h_flex().id(id).h(26).px(10).flex_none().items_center().rounded(6).border_1().border_color(t.border).bg(t.popover).text_size(12)
      .when(!enabled, (el) => el.opacity(0.5))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => action(cx)))
      .on_mouse_down("left", stop)
      .child(label);
  }

  chip(t, text, color) {
    return div().flex_none().h(20).px(8).rounded(10).border_1().border_color(color ?? t.border).text_size(11).text_color(color ?? t.muted)
      .flex().items_center().child(text);
  }

  header(t) {
    const busy = this.loading.size > 0;
    return v_flex().flex_none().border_b(1).border_color(t.border)
      .child(h_flex().h(42).px(14).gap(8).items_center()
        .child(div().text_size(14).font_semibold().child("Sentry"))
        .when(Boolean(this.org), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(this.org.slug)))
        .when(this.connected !== false, (el) => el.children(this.tabs().map((tab, n) => {
          const on = this.tab === tab && !this.detail;
          return h_flex().id(`tab-${tab}`).h(24).px(10).gap(6).items_center().rounded(12).border_1().text_size(12).cursor_pointer()
            .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted)
            .on_mouse_down("left", stop).on_click((_e, cx) => this.setTab(tab, cx))
            .child(`${n + 1}  ${TAB_LABEL[tab]}`)
            .when(Boolean(this.lists[`${tab}|${this.period}|${this.sort}|${this.query}`]), (el) =>
              el.child(div().text_size(10.5).text_color(t.dim).child(String(this.lists[`${tab}|${this.period}|${this.sort}|${this.query}`].length))));
        })))
        .child(div().flex_1())
        .when(busy, (el) => el.child(svg(`${ICON}/spinner.svg`).size(12).text_color(t.dim).spin(900)))
        .when(this.connected !== false, (el) => el
          .child(this.button(t, "h-period", `${this.period}  p`, (cx) => this.cycle("period", cx)))
          .child(this.button(t, "h-sort", `${SORT_LABEL[this.sort]}  f`, (cx) => this.cycle("sort", cx)))
          .child(this.button(t, "h-refresh", "↻  ⌘R", (cx) => this.reload(cx))))
        .when(Boolean(props()?.overlay), (el) => el.child(this.button(t, "h-close", "×", () => this.dismiss()))))
      .when(this.connected !== false, (el) => el.child(h_flex().h(36).px(14).pb(6).gap(8).items_center()
        .child(h_flex().flex_1().h(30).px(10).gap(8).items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).bg(t.background)
          .child(svg(`${ICON}/search.svg`).size(12).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.5)))
        .when(Boolean(this.query), (el) => el.child(this.chip(t, `filter: ${this.query}`, t.accent)))));
  }

  connectView(t) {
    return v_flex().flex_1().items_center().justify_center().gap(12)
      .child(div().text_size(13).text_color(t.muted).child("Connect your Sentry account once: it signs in through Sentry's own login."))
      .child(this.button(t, "c-connect", this.connecting ? "Waiting for the browser…" : "Connect Sentry", (cx) => this.connect(cx), !this.connecting));
  }

  listView(t) {
    const list = this.issues();
    const key = this.listKey();
    if (!list.length) {
      return v_flex().flex_1().items_center().justify_center().text_color(t.dim)
        .child(this.loading.has(key) || this.loading.has("org") ? "Loading…" : this.tab === "team" && !this.config.team ? "Set `team` in config.json" : "No unresolved issue here");
    }
    return v_flex().id("s-list").flex_1().min_h(0).py(4).overflow_y_scrollbar()
      .children(list.map((x, n) => this.row(t, x, n, n === this.sel)));
  }

  row(t, x, n, on) {
    const level = LEVEL[x.level] ?? (x.issueCategory === "error" ? LEVEL.error : t.dim);
    const sub = SUBSTATUS[x.substatus];
    return h_flex().id(`s-row-${n}`).mx(6).px(10).h(38).gap(10).items_center().rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
      .on_mouse_down("left", stop)
      .on_click((e, cx) => {
        this.handle.focus();
        if (on || e.click_count === 2) this.open({ issueId: x.shortId }, cx);
        else { this.sel = n; cx.notify(); }
      })
      .child(div().size(8).flex_none().rounded(4).bg(level))
      .child(h_flex().w(170).flex_none().child(div().id(`s-id-${n}`).truncate().text_size(11.5).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.accent)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.copy(x.shortId, cx); }).child(x.shortId)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().w_full().truncate().text_size(12.5).child(x.title ?? ""))
        .child(div().w_full().truncate().text_size(11).text_color(t.dim).child(x.culprit ?? x.projectSlug ?? "")))
      .when(Boolean(sub), (el) => el.child(this.chip(t, sub, sub === "new" ? t.accent : t.blocked)))
      .child(div().w(52).flex_none().text_size(11).text_color(t.muted).child(`${count(x.occurrences)} ev`))
      .child(div().w(44).flex_none().text_size(11).text_color(t.muted).child(x.usersImpacted ? `${count(x.usersImpacted)} us` : ""))
      .child(div().w(36).flex_none().text_size(11).text_color(t.dim).child(ago(x.lastSeen)))
      .child(div().w(110).flex_none().truncate().text_size(11).text_color(t.dim).child(x.assignedTo ?? ""));
  }

  detailView(t) {
    const d = this.detail, issue = d.issue;
    const bar = h_flex().h(40).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(this.button(t, "d-back", "← Back", (cx) => this.back(cx)))
      .child(div().id("d-id").text_size(13).font_semibold().cursor_pointer().hover((s) => s.text_color(t.accent))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.copy(d.shortId ?? d.label, cx)).child(d.shortId ?? d.label))
      .when(Boolean(issue?.status), (el) => el.child(this.chip(t, issue.substatus && issue.substatus !== issue.status ? `${issue.status} · ${issue.substatus}` : issue.status,
        issue.status === "resolved" ? t.done : null)))
      .child(div().flex_1())
      .when(Boolean(issue?.shortId), (el) => el
        .child(this.button(t, "d-claude", "Work with Claude  c", (cx) => this.work(issue, cx)))
        .child(this.button(t, "d-assign", "Assign me  a", (cx) => this.assignMe(issue, cx)))
        .child(this.button(t, "d-ignore", "Ignore  ⇧I", (cx) => this.ignore(issue, cx)))
        .child(this.button(t, "d-resolve", "Resolve  ⇧R", (cx) => this.resolve(issue, cx))))
      .when(Boolean(d.url), (el) => el.child(this.button(t, "d-open", "Sentry  o", (cx) => this.openUrl(d.url, cx))));
    const body = !d.md
      ? v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(`Loading ${d.label}…`)
      : v_flex().id("d-body").flex_1().min_h(0).px(18).py(12).overflow_y_scrollbar()
        .child(TextView.markdown(`d-md-${d.label}`, d.md).selectable().on_link_click((url, cx) => this.openUrl(url, cx)));
    return v_flex().flex_1().min_h(0).child(bar).child(body);
  }

  footer(t) {
    const s = this.status;
    const hint = this.typing ? "Enter search (an id, short id or link opens the issue) · Esc leave"
      : this.detail ? "Esc back · o open in Sentry · y copy link · i copy id · c work with Claude · a assign me · ⇧I ignore · ⇧R resolve · ⌘R refresh"
      : "↑↓ move · Enter open · / search or paste an id · 1–3 / Tab lists · p period · f sort · c work with Claude · a assign me · ⇧I ignore · ⇧R resolve · o Sentry · ⌘R refresh · Esc close";
    const color = s ? (s.level === "error" ? t.blocked : s.level === "success" ? t.done : t.muted) : t.dim;
    return h_flex().h(26).flex_none().px(12).gap(10).items_center().border_t(1).border_color(t.border).text_size(11)
      .child(div().flex_1().min_w(0).truncate().text_color(color).child(s?.text ?? hint))
      .child(div().flex_none().text_color(t.dim).child(this.me?.name ?? ""));
  }
}
