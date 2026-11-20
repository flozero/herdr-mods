import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { theme, props, closeOverlay, exec, appHome, home, readTextFile, writeTextFile } from "herdr";
import * as fs from "fs/promises";
import { METHODS, curlArgs, curlCommand, parseWrite, parseHeaders, pretty, sizeText, parseQuery, buildUrl, rowsOf, linesOf, safeName } from "./request.js";

const BASE = "mods/http";
const CACHE = () => `${appHome()}/${BASE}/.cache`;
const HISTORY = () => `${CACHE()}/history.json`;
const ROOT = () => `${home()}/.herdr/http`;
const BLANK = { method: "GET", url: "", headers: [], paramsOff: [], body: "" };
const MONO = "JetBrains Mono";
const KEEP = 50;
const SHOW_MAX = 300000;
const HISTORY_W = 250;
const stop = (_e, cx) => cx.stop_propagation();
const statusColor = (s, t) => (s >= 500 ? t.blocked : s >= 400 ? "#f08c00" : s >= 300 ? t.accent : s >= 200 ? t.done : t.dim);

export default class Http extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.method = "GET";
    this.url = InputState.new({ placeholder: "https://api.example.com/…" });
    this.url.on("submit", (_e, cx) => this.send(cx));
    this.url.on("change", (_e, cx) => { if (!this.syncing) { this.paramsFromUrl(); this.changed(cx); cx.notify(); } });
    this.body = TextareaState.new({ rows: 6, placeholder: '{"query": "…"}' });
    this.body.set_auto_grow(4, 18);
    this.body.on("change", (_e, cx) => { this.changed(cx); cx.notify(); });
    this.body.on("submit", (e, cx) => { if (e?.secondary) this.send(cx); });
    this.rowId = 0;
    this.params = [this.row("param")];
    this.headerRows = [this.row("header")];
    this.reqTab = "params";
    this.history = [];
    this.response = null;
    this.view = "body";
    this.menu = false;
    this.sending = false;
    this.status = null;
    this.projects = [];
    this.openReq = null;
    this.naming = null;
    this.nameInput = InputState.new({ placeholder: "" });
    this.nameInput.on("submit", (_e, cx) => this.finishNaming(cx));
    cx.spawn(async (cx) => {
      try { this.history = JSON.parse(await fs.readFile(HISTORY(), "utf8")) ?? []; } catch { this.history = []; }
      await this.loadProjects();
      if (this.history[0]) this.load(this.history[0], cx);
      cx.notify();
      cx.timer.after(50, () => this.url.focus());
    });
  }

  async dir() {
    await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", CACHE()]);
    return CACHE();
  }

  async saveHistory() {
    const dir = await this.dir();
    const tmp = `${dir}/history.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.history));
    await exec("mv", ["-f", tmp, HISTORY()]);
  }

  row(kind, data = {}) {
    const r = { id: ++this.rowId, kind, on: data.on !== false,
      key: InputState.new({ placeholder: kind === "param" ? "name" : "Header", value: data.key ?? "" }),
      value: InputState.new({ placeholder: "value", value: data.value ?? "" }) };
    for (const st of [r.key, r.value]) {
      st.on("change", (_e, cx) => this.rowChanged(r, cx));
      st.on("submit", (_e, cx) => this.send(cx));
    }
    return r;
  }

  rowsFor(kind) { return kind === "param" ? this.params : this.headerRows; }
  setRows(kind, rows) { if (kind === "param") this.params = rows; else this.headerRows = rows; }
  filled(r) { return Boolean(r.key.value() || r.value.value()); }
  dataOf(r) { return { on: r.on, key: r.key.value(), value: r.value.value() }; }

  withTrailing(kind, rows) {
    const last = rows.at(-1);
    return last && !this.filled(last) ? rows : [...rows, this.row(kind)];
  }

  rowChanged(r, cx) {
    if (this.syncing) return;
    const rows = this.rowsFor(r.kind);
    if (rows.at(-1) === r && this.filled(r)) this.setRows(r.kind, [...rows, this.row(r.kind)]);
    if (r.kind === "param") this.urlFromParams();
    this.changed(cx);
    cx.notify();
  }

  toggleRow(r, cx) {
    r.on = !r.on;
    if (r.kind === "param") this.urlFromParams();
    this.changed(cx);
    cx.notify();
  }

  dropRow(r, cx) {
    const rows = this.rowsFor(r.kind).filter((x) => x !== r);
    r.key.release();
    r.value.release();
    this.setRows(r.kind, this.withTrailing(r.kind, rows));
    if (r.kind === "param") this.urlFromParams();
    this.changed(cx);
    cx.notify();
  }

  urlFromParams() {
    const { base, hash } = parseQuery(this.url.value());
    const next = buildUrl(base, this.params.filter((r) => r.on && this.filled(r)).map((r) => ({ key: r.key.value(), value: r.value.value() })), hash);
    if (next === this.url.value()) return;
    this.syncing = true;
    try { this.url.set_value(next); } finally { this.syncing = false; }
  }

  paramsFromUrl(off = null) {
    const { pairs } = parseQuery(this.url.value());
    const live = this.params.filter((r) => r.on && this.filled(r));
    const kept = off ? off.map((d) => this.row("param", { ...d, on: false })) : this.params.filter((r) => !r.on && this.filled(r));
    this.syncing = true;
    try {
      const rows = pairs.map((p, i) => {
        const r = live[i];
        if (!r) return this.row("param", p);
        if (r.key.value() !== p.key) r.key.set_value(p.key);
        if (r.value.value() !== p.value) r.value.set_value(p.value);
        return r;
      });
      for (const r of live.slice(pairs.length)) { r.key.release(); r.value.release(); }
      if (off) for (const r of this.params.filter((x) => !x.on)) { r.key.release(); r.value.release(); }
      const empty = this.params.find((r) => !this.filled(r));
      this.params = [...rows, ...kept, empty ?? this.row("param")];
    } finally {
      this.syncing = false;
    }
  }

  current() {
    return {
      method: this.method, url: this.url.value().trim(),
      headers: this.headerRows.filter((r) => this.filled(r)).map((r) => this.dataOf(r)),
      paramsOff: this.params.filter((r) => !r.on && this.filled(r)).map((r) => ({ key: r.key.value(), value: r.value.value() })),
      body: this.body.value(),
    };
  }

  load(h, cx) {
    this.method = METHODS.includes(h.method) ? h.method : "GET";
    this.syncing = true;
    try { this.url.set_value(h.url ?? ""); } finally { this.syncing = false; }
    this.paramsFromUrl(h.paramsOff ?? []);
    for (const r of this.headerRows) { r.key.release(); r.value.release(); }
    this.headerRows = this.withTrailing("header", rowsOf(h.headers).map((d) => this.row("header", d)));
    this.body.set_value(h.body ?? "");
    cx.notify();
  }

  say(text, cx, level = "info") {
    this.status = { text, level };
    cx.notify();
    if (level !== "error") cx.timer.after(2500, (cx) => { if (this.status?.text === text) { this.status = null; cx.notify(); } });
  }

  send(cx) {
    const req = this.current();
    if (!req.url || this.sending) { if (!req.url) this.say("Type a URL", cx, "error"); return; }
    if (!/^[a-z]+:\/\//i.test(req.url)) req.url = `https://${req.url}`;
    this.sending = true;
    this.response = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const dir = await this.dir();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const f = { headerFile: `${dir}/h-${id}`, bodyFile: `${dir}/b-${id}`, outFile: `${dir}/o-${id}`, headersOut: `${dir}/d-${id}` };
      const lines = linesOf(rowsOf(req.headers));
      try {
        await fs.writeFile(f.headerFile, lines.join("\n") + (lines.length ? "\n" : ""));
        await fs.writeFile(f.bodyFile, req.body);
        const r = await exec("curl", curlArgs({ method: req.method, url: req.url, ...f, headerFile: lines.length ? f.headerFile : null, hasBody: req.body.length > 0 }), { timeout: 70000 });
        const w = parseWrite(r.stdout);
        if (r.code !== 0 && !w.status) throw new Error((r.stderr || `curl exited with ${r.code}`).trim().split("\n").pop());
        const head = parseHeaders(await fs.readFile(f.headersOut, "utf8").catch(() => ""));
        const type = head.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
        const binary = /^(image|audio|video|font)\/|octet-stream|zip|pdf/i.test(type);
        const text = binary ? "" : await fs.readFile(f.outFile, "utf8").catch(() => "");
        this.response = { ...w, ...head, type, binary, body: pretty(text, type), at: new Date().toISOString() };
        this.view = "body";
        this.remember(req, w.status);
      } catch (e) {
        this.response = { error: String(e?.message ?? e) };
      } finally {
        await exec("rm", ["-f", f.headerFile, f.bodyFile, f.outFile, f.headersOut]).catch(() => {});
        this.sending = false;
        cx.notify();
      }
    });
  }

  remember(req, status) {
    const same = (h) => h.method === req.method && h.url === req.url;
    this.history = [{ ...req, status, at: new Date().toISOString() }, ...this.history.filter((h) => !same(h))].slice(0, KEEP);
    this.saveHistory().catch(() => {});
  }

  forget(n, cx) {
    this.history.splice(n, 1);
    this.saveHistory().catch(() => {});
    cx.notify();
  }

  copyCurl(cx) {
    const req = this.current();
    if (!req.url) return;
    cx.write_to_clipboard(curlCommand({ ...req, headers: linesOf(rowsOf(req.headers)).join("\n") }));
    this.say("Copied as curl", cx, "success");
  }

  copyBody(cx) {
    if (!this.response?.body) return;
    cx.write_to_clipboard(this.response.body.text);
    this.say("Copied the response body", cx, "success");
  }

  pickMethod(m, cx) {
    this.method = m;
    this.menu = false;
    this.changed(cx);
    cx.notify();
  }

  async root() {
    await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", ROOT()]);
    return ROOT();
  }

  async loadProjects() {
    const root = await this.root();
    const was = new Map(this.projects.map((p) => [p.name, p.open]));
    const out = [];
    const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const d of dirs.filter((x) => x.isDirectory() && !x.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) {
      const files = (await fs.readdir(`${root}/${d.name}`, { withFileTypes: true }).catch(() => []))
        .filter((x) => !x.isDirectory() && x.name.endsWith(".json") && !x.name.startsWith(".")).map((x) => x.name.slice(0, -5)).sort((a, b) => a.localeCompare(b));
      const requests = [];
      for (const name of files) {
        let method = "GET";
        try { method = JSON.parse(await fs.readFile(`${root}/${d.name}/${name}.json`, "utf8"))?.method ?? "GET"; } catch {}
        requests.push({ name, method });
      }
      out.push({ name: d.name, requests, open: was.get(d.name) ?? (this.openReq?.project === d.name || dirs.length <= 3) });
    }
    this.projects = out;
  }

  fileOf(project, name) { return `${ROOT()}/${project}/${name}.json`; }

  startNaming(kind, project, cx) {
    this.naming = { kind, project };
    this.nameInput.set_value("");
    if (project) { const p = this.projects.find((x) => x.name === project); if (p) p.open = true; }
    cx.timer.after(0, () => this.nameInput.focus());
    cx.notify();
  }

  cancelNaming(cx) {
    this.naming = null;
    this.handle.focus();
    cx.notify();
  }

  finishNaming(cx) {
    const n = this.naming, name = safeName(this.nameInput.value());
    if (!n || !name) { this.cancelNaming(cx); return; }
    cx.spawn(async (cx) => {
      try {
        const root = await this.root();
        if (n.kind === "project") {
          if (await fs.exists(`${root}/${name}`)) throw new Error(`A project named ${name} exists already`);
          await writeTextFile(`${root}/${name}/.herdr-project`, "", null);
          this.naming = null;
          await this.loadProjects();
          this.startNaming("request", name, cx);
          return;
        }
        const file = this.fileOf(n.project, name);
        if (await fs.exists(file)) throw new Error(`${name} exists already in ${n.project}`);
        await this.writeJson(file, { ...BLANK, ...this.currentIfBlank() });
        this.naming = null;
        await this.loadProjects();
        await this.openRequest(n.project, name, cx);
      } catch (e) {
        this.say(String(e?.message ?? e), cx, "error");
      }
    });
  }

  currentIfBlank() {
    return this.openReq || !this.url.value().trim() ? {} : this.current();
  }

  async writeJson(file, data) {
    const text = `${JSON.stringify(data, null, 2)}\n`;
    const before = await readTextFile(file);
    if (before === text) return;
    await writeTextFile(file, text, before);
  }

  async openRequest(project, name, cx) {
    let h;
    try { h = JSON.parse(await fs.readFile(this.fileOf(project, name), "utf8")); }
    catch (e) { this.say(`Couldn't open ${name}: ${e?.message ?? e}`, cx, "error"); return; }
    this.openReq = null;
    this.load({ ...BLANK, ...h }, cx);
    this.openReq = { project, name };
    this.response = null;
    cx.notify();
  }

  changed(cx) {
    if (!this.openReq || this.syncing) return;
    const target = this.openReq, gen = (this.saveGen = (this.saveGen ?? 0) + 1);
    cx.timer.after(600, (cx) => {
      if (gen !== this.saveGen || this.openReq !== target) return;
      const data = this.current();
      this.writeJson(this.fileOf(target.project, target.name), data).then(() => {
        const r = this.projects.find((p) => p.name === target.project)?.requests.find((x) => x.name === target.name);
        if (r && r.method !== data.method) { r.method = data.method; cx.notify(); }
      }).catch((e) => this.say(`Couldn't save ${target.name}: ${e?.message ?? e}`, cx, "error"));
    });
  }

  trashRequest(project, name, cx) {
    cx.spawn(async (cx) => {
      const trash = `${await this.root()}/.trash`;
      await writeTextFile(`${trash}/.keep`, "", null).catch(() => {});
      const r = await exec("mv", [this.fileOf(project, name), `${trash}/${project} -- ${name} -- ${Date.now()}.json`]);
      if (r.code !== 0) { this.say(`Couldn't remove ${name}: ${r.stderr}`, cx, "error"); return; }
      if (this.openReq?.project === project && this.openReq?.name === name) this.openReq = null;
      await this.loadProjects();
      this.say(`${name} moved to ~/.herdr/http/.trash`, cx, "success");
    });
  }

  newRequest(cx) {
    this.openReq = null;
    this.load(BLANK, cx);
    this.response = null;
    cx.timer.after(0, () => this.url.focus());
  }

  onKey(e, cx) {
    const k = e.keystroke;
    if (k === "cmd-enter" || k === "ctrl-enter") { this.send(cx); cx.stop_propagation(); return; }
    if (k === "cmd-shift-c" || k === "ctrl-shift-c") { this.copyCurl(cx); cx.stop_propagation(); return; }
    if (k === "escape") {
      if (this.naming) this.cancelNaming(cx);
      else if (this.menu) { this.menu = false; cx.notify(); }
      else if (props()?.overlay) closeOverlay(props().overlay);
      else this.handle.focus();
      cx.stop_propagation();
    }
  }

  button(t, id, label, action, primary = false, enabled = true) {
    return h_flex().id(id).h(28).px(12).flex_none().items_center().rounded(6).border_1().text_size(12.5)
      .border_color(primary ? t.solid : t.border).bg(primary ? t.solid : t.popover).text_color(primary ? t.solid_foreground : t.foreground)
      .when(!enabled, (el) => el.opacity(0.5))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(primary ? t.solid : t.hover)).on_click((_e, cx) => action(cx)))
      .on_mouse_down("left", stop)
      .child(label);
  }

  table(t, kind) {
    const rows = this.rowsFor(kind);
    const cell = (id, state) => h_flex().id(id).h(26).px(8).items_center().rounded(5).border_1().border_color(t.border).bg(t.background)
      .on_mouse_down("left", stop).child(Input.new(state).flex_1().h_full().font_family(MONO).text_size(12));
    return v_flex().w_full().gap(4)
      .child(h_flex().px(4).gap(8).text_size(11).text_color(t.dim)
        .child(div().w(18).flex_none()).child(div().w(260).flex_none().child(kind === "param" ? "Name" : "Header")).child(div().flex_1().child("Value")).child(div().w(18).flex_none()))
      .children(rows.map((r) => {
        const empty = !this.filled(r);
        return h_flex().id(`${kind}-${r.id}`).w_full().px(4).gap(8).items_center().when(!r.on && !empty, (el) => el.opacity(0.5))
          .child(div().id(`${kind}-on-${r.id}`).size(16).flex_none().rounded(4).border_1().flex().items_center().justify_center()
            .border_color(r.on && !empty ? t.accent : t.border).bg(r.on && !empty ? t.accent : t.background)
            .text_size(11).font_semibold().text_color("#ffffff").cursor_pointer()
            .on_mouse_down("left", stop).on_click((_e, cx) => { if (!empty) this.toggleRow(r, cx); }).child(r.on && !empty ? "✓" : ""))
          .child(div().w(260).flex_none().child(cell(`${kind}-k-${r.id}`, r.key)))
          .child(div().flex_1().min_w(0).child(cell(`${kind}-v-${r.id}`, r.value)))
          .child(div().id(`${kind}-x-${r.id}`).w(18).flex_none().text_size(12).text_color(t.dim)
            .when(!empty, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_mouse_down("left", stop).on_click((_e, cx) => this.dropRow(r, cx)).child("×")));
      }));
  }

  field(t, id, state) {
    return div().id(id).w_full().min_w(0).rounded(8).border_1().border_color(t.border).bg(t.background).font_family(MONO).text_size(12)
      .on_mouse_down("left", stop).child(Textarea.new(state).w_full());
  }

  label(t, text, extra = null) {
    return h_flex().gap(8).items_center().text_size(11).font_semibold().text_color(t.dim).child(text).when(Boolean(extra), (el) => el.child(extra));
  }

  render() {
    const t = theme();
    return v_flex().id("http-root").relative().size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .child(this.bar(t))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .child(v_flex().id("http-side").w(HISTORY_W).flex_none().min_h(0).py(8).gap(10).border_r(1).border_color(t.border).overflow_y_scrollbar()
          .child(this.projectsView(t))
          .child(this.historyView(t)))
        .child(v_flex().id("http-main").flex_1().min_w(0).min_h(0).p(14).gap(12).overflow_y_scrollbar()
          .child(this.requestView(t))
          .child(this.responseView(t))))
      .child(this.footer(t))
      .when(this.menu, (el) => el.child(this.methodMenu(t)));
  }

  bar(t) {
    return h_flex().h(48).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(14).font_semibold().child("HTTP"))
      .when(Boolean(this.openReq), (el) => el.child(div().max_w(220).truncate().text_size(12).text_color(t.muted).child(`${this.openReq.project} / ${this.openReq.name}`)))
      .child(this.button(t, "new", "New", (cx) => this.newRequest(cx)))
      .child(h_flex().id("m-pick").h(30).w(92).flex_none().px(10).gap(6).items_center().justify_between().rounded(6).border_1().border_color(t.border)
        .font_family(MONO).text_size(12).font_semibold().cursor_pointer().hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => { this.menu = !this.menu; cx.notify(); })
        .child(this.method).child(div().text_color(t.dim).child("▾")))
      .child(h_flex().flex_1().min_w(0).h(30).px(10).items_center().rounded(6).border_1().border_color(t.border).bg(t.background)
        .font_family(MONO).text_size(12.5).child(Input.new(this.url).flex_1().h_full()))
      .child(this.button(t, "send", this.sending ? "Sending…" : "Send  ⌘↵", (cx) => this.send(cx), true, !this.sending))
      .child(this.button(t, "curl", "Copy as curl", (cx) => this.copyCurl(cx)))
      .when(Boolean(props()?.overlay), (el) => el.child(this.button(t, "close", "×", () => closeOverlay(props().overlay))));
  }

  methodMenu(t) {
    return v_flex().absolute().top(44).left(60).w(120).p(4).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover)
      .children(METHODS.map((m) => h_flex().id(`m-${m}`).h(26).px(8).items_center().rounded(5).font_family(MONO).text_size(12).cursor_pointer()
        .when(m === this.method, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.pickMethod(m, cx)).child(m)));
  }

  nameRow(t, id, hint, pad) {
    return v_flex().mx(6).pl(pad).gap(2)
      .child(h_flex().id(id).h(28).px(8).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background)
        .on_mouse_down("left", stop).child(Input.new(this.nameInput).flex_1().h_full().text_size(12)))
      .child(div().px(4).text_size(10.5).text_color(t.dim).child(hint));
  }

  projectsView(t) {
    const n = this.naming;
    const head = h_flex().px(12).pb(2).gap(6).items_center()
      .child(div().flex_1().text_size(11).font_semibold().text_color(t.dim).child("PROJECTS"))
      .child(div().id("p-new").px(6).rounded(5).text_size(13).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.startNaming("project", null, cx)).child("+"));
    const rows = [];
    if (n?.kind === "project") rows.push(this.nameRow(t, "p-name", "Project name · Enter · Esc", 0));
    if (!this.projects.length && n?.kind !== "project") rows.push(div().px(12).text_size(12).text_color(t.dim).child("+ to create a project"));
    this.projects.forEach((p, k) => {
      rows.push(h_flex().id(`proj-${k}`).mx(6).px(6).h(28).gap(6).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => { p.open = !p.open; cx.notify(); })
        .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(p.open ? "▾" : "▸"))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().child(p.name))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(p.requests.length)))
        .child(div().id(`proj-add-${k}`).flex_none().px(5).rounded(5).text_size(13).text_color(t.muted).hover((s) => s.bg(t.raised ?? t.selected).text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.startNaming("request", p.name, cx); }).child("+")));
      if (!p.open) return;
      if (n?.kind === "request" && n.project === p.name) rows.push(this.nameRow(t, `r-name-${k}`, `Request name in ${p.name} · Enter · Esc`, 16));
      p.requests.forEach((r, j) => {
        const on = this.openReq?.project === p.name && this.openReq?.name === r.name;
        rows.push(h_flex().id(`req-${k}-${j}`).mx(6).pl(22).pr(6).h(28).gap(8).items_center().rounded(6).cursor_pointer()
          .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
          .on_mouse_down("left", stop).on_click((_e, cx) => cx.spawn(async (cx) => this.openRequest(p.name, r.name, cx)))
          .child(div().w(46).flex_none().font_family(MONO).text_size(10.5).font_semibold().text_color(t.muted).child(r.method))
          .child(div().flex_1().min_w(0).truncate().text_size(12).child(r.name))
          .child(div().id(`req-x-${k}-${j}`).flex_none().px(4).text_size(11).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.trashRequest(p.name, r.name, cx); }).child("×")));
      });
    });
    return v_flex().w_full().gap(1).child(head).children(rows);
  }

  historyView(t) {
    return v_flex().id("http-history").w_full().gap(1)
      .child(div().px(12).pb(6).text_size(11).font_semibold().text_color(t.dim).child("HISTORY"))
      .when(!this.history.length, (el) => el.child(div().px(12).text_size(12).text_color(t.dim).child("Requests you send show up here")))
      .children(this.history.map((h, n) => h_flex().id(`hist-${n}`).mx(6).px(8).h(34).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => { this.openReq = null; this.load(h, cx); })
        .child(div().w(46).flex_none().font_family(MONO).text_size(10.5).font_semibold().text_color(t.muted).child(h.method))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).child(h.url.replace(/^https?:\/\//, "")))
        .when(Boolean(h.status), (el) => el.child(div().flex_none().text_size(10.5).text_color(statusColor(h.status, t)).child(String(h.status))))
        .child(div().id(`hist-x-${n}`).flex_none().px(4).text_size(11).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.forget(n, cx); }).child("×"))));
  }

  requestView(t) {
    const noBody = this.method === "GET" || this.method === "HEAD";
    const count = (rows) => rows.filter((r) => r.on && this.filled(r)).length;
    const tab = (id, text, n) => h_flex().id(`qt-${id}`).h(26).px(12).gap(6).items_center().rounded(13).border_1().text_size(12).cursor_pointer()
      .border_color(this.reqTab === id ? t.accent : t.border).bg(this.reqTab === id ? t.selected : t.popover)
      .on_mouse_down("left", stop).on_click((_e, cx) => { this.reqTab = id; cx.notify(); })
      .child(text).when(n !== null && n !== undefined, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(String(n))));
    return v_flex().w_full().gap(10)
      .child(h_flex().gap(6).items_center()
        .child(tab("params", "Params", count(this.params) || null))
        .child(tab("headers", "Headers", count(this.headerRows) || null))
        .child(tab("body", "Body", this.body.value().length && !noBody ? "•" : null)))
      .child(this.reqTab === "params" ? this.table(t, "param")
        : this.reqTab === "headers" ? this.table(t, "header")
        : v_flex().w_full().gap(6)
          .when(noBody, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`Not sent with ${this.method}.`)))
          .child(this.field(t, "f-body", this.body)));
  }

  responseView(t) {
    const r = this.response;
    const head = this.label(t, "RESPONSE");
    if (this.sending) return v_flex().gap(8).child(head).child(div().text_color(t.dim).child("Waiting for the answer…"));
    if (!r) return v_flex().gap(8).child(head).child(div().text_color(t.dim).child("Send a request to see its answer here."));
    if (r.error) return v_flex().gap(8).child(head).child(div().text_color(t.blocked).font_family(MONO).text_size(12).child(r.error));
    const tab = (id, text) => h_flex().id(`rt-${id}`).h(24).px(10).items_center().rounded(12).border_1().text_size(12).cursor_pointer()
      .border_color(this.view === id ? t.accent : t.border).bg(this.view === id ? t.selected : t.popover)
      .on_mouse_down("left", stop).on_click((_e, cx) => { this.view = id; cx.notify(); }).child(text);
    const body = r.binary ? `_${r.type || "binary"} body, ${sizeText(r.size)}: not shown_`
      : !r.body.text ? "_Empty body_"
      : r.body.text.length > SHOW_MAX ? `\`\`\`\n${r.body.text.slice(0, SHOW_MAX)}\n\`\`\`\n\n_Cut at ${sizeText(SHOW_MAX)}: copy the body to see it all._`
      : `\`\`\`${r.body.kind === "json" ? "json" : ""}\n${r.body.text}\n\`\`\``;
    return v_flex().w_full().gap(10)
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(11).font_semibold().text_color(t.dim).child("RESPONSE"))
        .child(div().h(22).px(10).rounded(11).bg(statusColor(r.status, t)).text_size(12).font_semibold().text_color("#ffffff").flex().items_center()
          .child(r.statusLine.replace(/^HTTP\/[\d.]+\s*/, "") || String(r.status)))
        .child(div().text_size(12).text_color(t.muted).child(`${r.ms} ms · ${sizeText(r.size)}${r.redirects ? ` · ${r.redirects} redirect${r.redirects > 1 ? "s" : ""}` : ""}`))
        .child(div().flex_1())
        .child(tab("body", "Body")).child(tab("headers", `Headers ${r.headers.length}`))
        .when(!r.binary && Boolean(r.body.text), (el) => el.child(this.button(t, "copy-body", "Copy body", (cx) => this.copyBody(cx)))))
      .child(this.view === "headers"
        ? v_flex().w_full().gap(2).font_family(MONO).text_size(12).children(r.headers.map(([k, v], n) => h_flex().id(`rh-${n}`).gap(8).items_start()
          .child(div().w(220).flex_none().truncate().text_color(t.muted).child(k)).child(div().flex_1().min_w(0).child(v))))
        : TextView.markdown(`resp-${r.at}`, body).selectable());
  }

  footer(t) {
    const s = this.status;
    const color = s ? (s.level === "error" ? t.blocked : s.level === "success" ? t.done : t.muted) : t.dim;
    return h_flex().h(26).flex_none().px(12).items_center().border_t(1).border_color(t.border).text_size(11)
      .child(div().flex_1().min_w(0).truncate().text_color(color)
        .child(s?.text ?? (this.openReq ? `${this.openReq.project} / ${this.openReq.name} saves itself as you edit · ⌘↵ send · ⌘⇧C copy as curl` : "⌘↵ send · ⌘⇧C copy as curl · + beside a project saves a request in it · Params follow the URL both ways")));
  }
}
