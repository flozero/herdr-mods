import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { theme, props, exec, appHome, home, readTextFile, writeTextFile, watchFolder, panes, window as appWindow } from "herdr";
import * as fs from "fs/promises";
import { keyLabels } from "./kbd.js";
import { METHODS, BODY_TYPES, hasBody, curlArgs, curlCommand, parseWrite, parseHeaders, pretty, sizeText, parseQuery, buildUrl, rowsOf, safeName, safeVar, normalize, resolve, setFrom, varsIn } from "./request.js";

const CACHE = () => `${appHome()}/mods/http/.cache`;
const VARS = (scope) => `${CACHE()}/vars/${scope || ".scratch"}.json`;
const ROOT = () => `${home()}/.herdr/http`;
const BLANK = normalize({});
const MONO = "JetBrains Mono";
const SHOW_MAX = 300000;
const SIDE_W = 230;
const KEY_W = 200;
const stop = (_e, cx) => cx.stop_propagation();
let platform;
const kbd = (text) => keyLabels(text, (platform ??= appWindow()?.platform));
const statusColor = (s, t) => (s >= 500 ? t.blocked : s >= 400 ? "#f08c00" : s >= 300 ? t.accent : s >= 200 ? t.done : t.dim);
const METHOD_COLORS = { GET: "#2f9e44", POST: "#f08c00", PUT: "#1971c2", PATCH: "#9c36b5", DELETE: "#e03131" };
const methodColor = (m, t) => METHOD_COLORS[m] ?? t.muted;
const store = globalThis.localStorage;
const PLACEHOLDERS = {
  param: ["name", "value"],
  header: ["Header", "value"],
  form: ["field", "value"],
  set: ["variable", "body.data.token"],
};

export default class Http extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.method = "GET";
    this.url = InputState.new({ placeholder: "https://api.example.com/… or {{base}}/…" });
    this.url.on("submit", (_e, cx) => this.send(cx));
    this.url.on("change", (_e, cx) => { if (!this.syncing) { this.paramsFromUrl(); this.changed(cx); cx.notify(); } });
    this.body = TextareaState.new({ rows: 8, placeholder: '{"query": "…", "token": "{{token}}"}' });
    this.body.set_auto_grow(6, 24);
    this.body.on("change", (_e, cx) => { this.changed(cx); cx.notify(); });
    this.body.on("submit", (e, cx) => { if (e?.secondary) this.send(cx); });
    this.rowId = 0;
    this.rows = { param: [this.row("param")], header: [this.row("header")], form: [this.row("form")], set: [this.row("set")] };
    this.bodyType = "none";
    this.notes = "";
    this.reqTab = "params";
    this.response = null;
    this.view = "body";
    this.menu = false;
    this.sending = false;
    this.status = null;
    this.projects = [];
    this.openReq = null;
    this.naming = null;
    this.side = store?.getItem("http.side") !== "off";
    this.vars = {};
    this.varRows = [];
    this.scope = null;
    this.nameInput = InputState.new({ placeholder: "" });
    this.nameInput.on("submit", (_e, cx) => this.finishNaming(cx));
    cx.spawn(async (cx) => {
      await this.loadProjects();
      const p = props() ?? {};
      const last = (() => { try { return JSON.parse(store?.getItem("http.open") ?? "null"); } catch { return null; } })();
      const pick = p.project && p.name ? p : last;
      if (pick?.project && pick?.name && this.projects.some((x) => x.name === pick.project && x.requests.some((r) => r.name === pick.name))) await this.openRequest(pick.project, pick.name, cx);
      else await this.useScope("", cx);
      cx.notify();
      cx.timer.after(50, () => this.url.focus());
      await this.watch(cx);
    });
  }

  async ensure(dir) {
    await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", dir]);
    return dir;
  }

  row(kind, data = {}) {
    const [k, v] = PLACEHOLDERS[kind];
    const r = { id: ++this.rowId, kind, on: data.on !== false,
      key: InputState.new({ placeholder: k, value: data.key ?? "" }),
      value: InputState.new({ placeholder: v, value: data.value ?? "" }) };
    for (const st of [r.key, r.value]) {
      st.on("change", (_e, cx) => this.rowChanged(r, cx));
      st.on("submit", (_e, cx) => this.send(cx));
    }
    return r;
  }

  release(rows) { for (const r of rows) { r.key.release(); r.value.release(); } }
  filled(r) { return Boolean(r.key.value() || r.value.value()); }
  dataOf(r) { return { on: r.on, key: r.key.value(), value: r.value.value() }; }
  live(kind) { return this.rows[kind].filter((r) => this.filled(r)).map((r) => this.dataOf(r)); }

  withTrailing(kind, rows) {
    const last = rows.at(-1);
    return last && !this.filled(last) ? rows : [...rows, this.row(kind)];
  }

  setRows(kind, data) {
    this.release(this.rows[kind]);
    this.rows[kind] = this.withTrailing(kind, rowsOf(data).map((d) => this.row(kind, d)));
  }

  rowChanged(r, cx) {
    if (this.syncing) return;
    const rows = this.rows[r.kind];
    if (rows.at(-1) === r && this.filled(r)) this.rows[r.kind] = [...rows, this.row(r.kind)];
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
    const rows = this.rows[r.kind].filter((x) => x !== r);
    this.release([r]);
    this.rows[r.kind] = this.withTrailing(r.kind, rows);
    if (r.kind === "param") this.urlFromParams();
    this.changed(cx);
    cx.notify();
  }

  urlFromParams() {
    const { base, hash } = parseQuery(this.url.value());
    const next = buildUrl(base, this.rows.param.filter((r) => r.on && this.filled(r)).map((r) => ({ key: r.key.value(), value: r.value.value() })), hash);
    if (next === this.url.value()) return;
    this.syncing = true;
    try { this.url.set_value(next); } finally { this.syncing = false; }
  }

  paramsFromUrl(off = null) {
    const { pairs } = parseQuery(this.url.value());
    const params = this.rows.param;
    const live = params.filter((r) => r.on && this.filled(r));
    const kept = off ? off.map((d) => this.row("param", { ...d, on: false })) : params.filter((r) => !r.on && this.filled(r));
    this.syncing = true;
    try {
      const rows = pairs.map((p, i) => {
        const r = live[i];
        if (!r) return this.row("param", p);
        if (r.key.value() !== p.key) r.key.set_value(p.key);
        if (r.value.value() !== p.value) r.value.set_value(p.value);
        return r;
      });
      this.release(live.slice(pairs.length));
      if (off) this.release(params.filter((x) => !x.on));
      const empty = params.find((r) => !this.filled(r));
      this.rows.param = [...rows, ...kept, empty ?? this.row("param")];
    } finally {
      this.syncing = false;
    }
  }

  current() {
    return {
      method: this.method, url: this.url.value().trim(),
      headers: this.live("header"),
      paramsOff: this.rows.param.filter((r) => !r.on && this.filled(r)).map((r) => ({ key: r.key.value(), value: r.value.value() })),
      bodyType: this.bodyType, body: this.body.value(),
      form: this.live("form"), set: this.live("set"),
      ...(this.notes ? { notes: this.notes } : {}),
    };
  }

  load(raw, cx) {
    const h = normalize(raw);
    this.method = h.method;
    this.syncing = true;
    try {
      this.url.set_value(h.url);
      this.body.set_value(h.body);
    } finally { this.syncing = false; }
    this.paramsFromUrl(h.paramsOff);
    this.setRows("header", h.headers);
    this.setRows("form", h.form);
    this.setRows("set", h.set);
    this.bodyType = h.bodyType;
    this.notes = h.notes ?? "";
    cx.notify();
  }

  say(text, cx, level = "info") {
    this.status = { text, level };
    cx.notify();
    if (level !== "error") cx.timer.after(3500, (cx) => { if (this.status?.text === text) { this.status = null; cx.notify(); } });
  }

  async useScope(scope, cx) {
    if (this.scope === scope) return;
    this.scope = scope;
    let vars = {};
    try { vars = JSON.parse(await fs.readFile(VARS(scope), "utf8")) ?? {}; } catch {}
    this.setVars(vars);
    cx.notify();
  }

  setVars(vars) {
    for (const v of this.varRows) v.input.release();
    this.vars = { ...vars };
    this.varRows = Object.keys(this.vars).sort((a, b) => a.localeCompare(b)).map((name) => this.varRow(name));
  }

  varRow(name) {
    const input = InputState.new({ placeholder: "value", value: String(this.vars[name] ?? "") });
    input.on("change", (_e, cx) => { if (this.syncing) return; this.vars[name] = input.value(); this.saveVars(cx); });
    return { name, input };
  }

  putVars(values, cx) {
    for (const [name, value] of Object.entries(values)) {
      this.vars[name] = value;
      const row = this.varRows.find((v) => v.name === name);
      if (!row) { this.varRows.push(this.varRow(name)); continue; }
      this.syncing = true;
      try { row.input.set_value(value); } finally { this.syncing = false; }
    }
    this.varRows.sort((a, b) => a.name.localeCompare(b.name));
    this.saveVars(cx);
  }

  dropVar(name, cx) {
    delete this.vars[name];
    const row = this.varRows.find((v) => v.name === name);
    row?.input.release();
    this.varRows = this.varRows.filter((v) => v !== row);
    this.saveVars(cx);
    cx.notify();
  }

  clearVars(cx) {
    this.setVars({});
    this.saveVars(cx);
    this.say("Variables cleared", cx, "success");
  }

  saveVars(cx) {
    const scope = this.scope, data = JSON.stringify(this.vars, null, 2), gen = (this.varGen = (this.varGen ?? 0) + 1);
    cx.timer.after(300, () => {
      if (gen !== this.varGen) return;
      cx.spawn(async () => {
        await this.ensure(`${CACHE()}/vars`);
        const file = VARS(scope), tmp = `${file}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, data);
        await exec("mv", ["-f", tmp, file]);
      });
    });
  }

  resolved() {
    const req = this.current();
    const r = resolve(req, this.vars);
    if (r.url && !/^[a-z]+:\/\//i.test(r.url)) r.url = `https://${r.url}`;
    return { req, r };
  }

  send(cx) {
    const { req, r } = this.resolved();
    if (this.sending) return;
    if (!req.url) { this.say("Type a URL", cx, "error"); return; }
    if (r.missing.length) { this.say(`No value for ${r.missing.map((n) => `{{${n}}}`).join(", ")}: give it one in Variables, or send the request that sets it`, cx, "error"); return; }
    this.sending = true;
    this.response = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const dir = await this.ensure(CACHE());
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const f = { headerFile: `${dir}/h-${id}`, bodyFile: `${dir}/b-${id}`, outFile: `${dir}/o-${id}`, headersOut: `${dir}/d-${id}` };
      try {
        await fs.writeFile(f.headerFile, r.headers.join("\n") + (r.headers.length ? "\n" : ""));
        if (r.data != null) await fs.writeFile(f.bodyFile, r.data);
        const res = await exec("curl", curlArgs({ method: r.method, url: r.url, ...f, headerFile: r.headers.length ? f.headerFile : null,
          bodyFile: r.data ? f.bodyFile : null, parts: r.parts, home: home() }), { timeout: 70000 });
        const w = parseWrite(res.stdout);
        if (res.code !== 0 && !w.status) throw new Error((res.stderr || `curl exited with ${res.code}`).trim().split("\n").pop());
        const head = parseHeaders(await fs.readFile(f.headersOut, "utf8").catch(() => ""));
        const type = head.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
        const binary = /^(image|audio|video|font)\/|octet-stream|zip|pdf/i.test(type);
        const text = binary ? "" : await fs.readFile(f.outFile, "utf8").catch(() => "");
        this.response = { ...w, ...head, type, binary, body: pretty(text, type), at: new Date().toISOString() };
        this.view = "body";
        this.applySet(req.set, { status: w.status, headers: head.headers, text }, cx);
      } catch (e) {
        this.response = { error: String(e?.message ?? e) };
      } finally {
        await exec("rm", ["-f", f.headerFile, f.bodyFile, f.outFile, f.headersOut]).catch(() => {});
        this.sending = false;
        cx.notify();
      }
    });
  }

  applySet(set, res, cx) {
    if (!set.some((s) => s.on && s.key.trim())) return;
    const { values, errors } = setFrom(set, res);
    const names = Object.keys(values);
    if (names.length) this.putVars(values, cx);
    this.response.set = { names, errors };
    if (errors.length) this.say(`Not set: ${errors.join(" · ")}`, cx, "error");
    else this.say(`Set ${names.map((n) => `{{${n}}}`).join(", ")}`, cx, "success");
  }

  copyCurl(cx) {
    const { req, r } = this.resolved();
    if (!req.url) return;
    cx.write_to_clipboard(curlCommand(r));
    this.say(r.missing.length ? `Copied as curl, without a value for ${r.missing.join(", ")}` : "Copied as curl, variables filled in", cx, "success");
  }

  copyBody(cx) {
    if (!this.response?.body) return;
    cx.write_to_clipboard(this.response.body.text);
    this.say("Copied the response body", cx, "success");
  }

  formatBody(cx) {
    try {
      this.body.set_value(JSON.stringify(JSON.parse(this.body.value()), null, 2));
      this.changed(cx);
      cx.notify();
    } catch (e) {
      this.say(`Not JSON: ${e?.message ?? e}`, cx, "error");
    }
  }

  pickMethod(m, cx) {
    this.method = m;
    this.menu = false;
    this.changed(cx);
    cx.notify();
  }

  pickBodyType(id, cx) {
    this.bodyType = id;
    this.changed(cx);
    cx.notify();
  }

  toggleSide(cx) {
    this.side = !this.side;
    store?.setItem("http.side", this.side ? "on" : "off");
    cx.notify();
  }

  async root() { return this.ensure(ROOT()); }

  async loadProjects() {
    const root = await this.root();
    const was = new Map(this.projects.map((p) => [p.name, p.open]));
    const out = [];
    const dirs = (await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter((x) => x.isDirectory() && !x.name.startsWith("."));
    for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
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

  async watch(cx) {
    const root = await this.root();
    const openFile = `${root}/.open.json`;
    const readOpen = async () => { try { return JSON.parse(await fs.readFile(openFile, "utf8")); } catch { return null; } };
    this.seenOpen = (await readOpen())?.id ?? null;
    for (;;) {
      let changed;
      try { changed = await watchFolder(root); } catch { return; }
      const all = changed.some((p) => p.replace(/\/+$/, "") === root);
      const asked = await readOpen();
      if (asked?.id && asked.id !== this.seenOpen) {
        this.seenOpen = asked.id;
        await this.loadProjects();
        await this.openRequest(safeName(asked.project), safeName(asked.name), cx);
        const tabs = [...new Set(panes().filter((p) => p.mod === "http").map((p) => p.tab))];
        await fs.writeFile(`${root}/.opened.json`, JSON.stringify({ id: asked.id, tabs })).catch(() => {});
        cx.notify();
        continue;
      }
      if (!all && !changed.some((p) => p.endsWith(".json") && !/\/\.[^/]*$/.test(p) && !p.includes("/.trash/"))) continue;
      await this.loadProjects();
      const o = this.openReq;
      if (o) {
        const text = await readTextFile(this.fileOf(o.project, o.name)).catch(() => null);
        if (text == null) { this.openReq = null; this.say(`${o.name} was removed`, cx, "error"); }
        else if (text !== this.lastText) {
          this.lastText = text;
          try { this.openReq = null; this.load(JSON.parse(text), cx); this.say(`${o.name} changed on disk: reloaded`, cx); } catch {}
          this.openReq = o;
        }
      }
      cx.notify();
    }
  }

  startNaming(kind, project, cx) {
    this.naming = { kind, project };
    this.nameInput.set_value("");
    if (project) { const p = this.projects.find((x) => x.name === project); if (p) p.open = true; }
    if (kind === "var" && !this.side) this.side = true;
    cx.timer.after(0, () => this.nameInput.focus());
    cx.notify();
  }

  cancelNaming(cx) {
    this.naming = null;
    this.handle.focus();
    cx.notify();
  }

  finishNaming(cx) {
    const n = this.naming;
    if (n?.kind === "var") {
      const name = safeVar(this.nameInput.value());
      this.naming = null;
      if (!name) { this.cancelNaming(cx); return; }
      if (!Object.hasOwn(this.vars, name)) this.putVars({ [name]: "" }, cx);
      cx.timer.after(0, () => this.varRows.find((v) => v.name === name)?.input.focus());
      cx.notify();
      return;
    }
    const name = safeName(this.nameInput.value());
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
        await this.writeJson(file, normalize(this.openReq || !this.url.value().trim() ? {} : this.current()));
        this.naming = null;
        await this.loadProjects();
        await this.openRequest(n.project, name, cx);
      } catch (e) {
        this.say(String(e?.message ?? e), cx, "error");
      }
    });
  }

  async writeJson(file, data) {
    const text = `${JSON.stringify(data, null, 2)}\n`;
    const before = await readTextFile(file);
    if (before === text) return;
    this.lastText = text;
    await writeTextFile(file, text, before);
  }

  async openRequest(project, name, cx) {
    let text;
    try { text = await fs.readFile(this.fileOf(project, name), "utf8"); }
    catch (e) { this.say(`Couldn't open ${name}: ${e?.message ?? e}`, cx, "error"); return; }
    this.openReq = null;
    try { this.load(JSON.parse(text), cx); } catch (e) { this.say(`${name} isn't valid JSON: ${e?.message ?? e}`, cx, "error"); return; }
    this.lastText = text;
    this.openReq = { project, name };
    const p = this.projects.find((x) => x.name === project);
    if (p) p.open = true;
    store?.setItem("http.open", JSON.stringify(this.openReq));
    this.response = null;
    await this.useScope(project, cx);
    cx.notify();
  }

  changed(cx) {
    if (!this.openReq || this.syncing) return;
    const target = this.openReq, gen = (this.saveGen = (this.saveGen ?? 0) + 1);
    cx.timer.after(600, (cx) => {
      if (gen !== this.saveGen || this.openReq !== target) return;
      const data = normalize(this.current());
      this.writeJson(this.fileOf(target.project, target.name), data).then(() => {
        const r = this.projects.find((p) => p.name === target.project)?.requests.find((x) => x.name === target.name);
        if (r && r.method !== data.method) { r.method = data.method; cx.notify(); }
      }).catch((e) => this.say(`Couldn't save ${target.name}: ${e?.message ?? e}`, cx, "error"));
    });
  }

  trashRequest(project, name, cx) {
    cx.spawn(async (cx) => {
      const trash = await this.ensure(`${await this.root()}/.trash`);
      const r = await exec("mv", [this.fileOf(project, name), `${trash}/${project} -- ${name} -- ${Date.now()}.json`]);
      if (r.code !== 0) { this.say(`Couldn't remove ${name}: ${r.stderr}`, cx, "error"); return; }
      if (this.openReq?.project === project && this.openReq?.name === name) { this.openReq = null; store?.removeItem("http.open"); }
      await this.loadProjects();
      this.say(`${name} moved to ~/.herdr/http/.trash`, cx, "success");
    });
  }

  newRequest(cx) {
    this.openReq = null;
    store?.removeItem("http.open");
    this.load(BLANK, cx);
    this.response = null;
    this.reqTab = "params";
    cx.spawn(async (cx) => this.useScope("", cx));
    cx.timer.after(0, () => this.url.focus());
  }

  onKey(e, cx) {
    const k = e.keystroke;
    if (k === "cmd-enter" || k === "ctrl-enter") { this.send(cx); cx.stop_propagation(); return; }
    if (k === "cmd-shift-c" || k === "ctrl-shift-c") { this.copyCurl(cx); cx.stop_propagation(); return; }
    if (k === "escape") {
      if (this.naming) this.cancelNaming(cx);
      else if (this.menu) { this.menu = false; cx.notify(); }
      else this.handle.focus();
      cx.stop_propagation();
    }
  }

  button(t, id, label, action, { primary = false, enabled = true, small = false } = {}) {
    return h_flex().id(id).h(small ? 24 : 30).px(small ? 8 : 14).flex_none().items_center().justify_center().rounded(6).border_1().text_size(small ? 11.5 : 12.5)
      .border_color(primary ? t.solid : t.border).bg(primary ? t.solid : t.popover).text_color(primary ? t.solid_foreground : t.foreground)
      .when(primary, (el) => el.font_semibold())
      .when(!enabled, (el) => el.opacity(0.5))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(primary ? t.solid : t.hover)).on_click((_e, cx) => action(cx)))
      .on_mouse_down("left", stop)
      .child(kbd(label));
  }

  icon(t, id, label, action, title = null) {
    return div().id(id).flex_none().px(6).h(22).flex().items_center().rounded(5).text_size(12.5).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((e, cx) => { cx.stop_propagation(); action(cx, e); })
      .child(title ? `${label} ${title}` : label);
  }

  hint(t, text) {
    return div().text_size(11.5).text_color(t.dim).child(text);
  }

  table(t, kind, labels) {
    const rows = this.rows[kind];
    const cell = (id, state) => h_flex().id(id).h(28).px(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.background)
      .on_mouse_down("left", stop).child(Input.new(state).flex_1().h_full().font_family(MONO).text_size(12));
    return v_flex().w_full().gap(4)
      .child(h_flex().px(4).gap(8).text_size(10.5).font_semibold().text_color(t.dim)
        .child(div().w(18).flex_none()).child(div().w(KEY_W).flex_none().child(labels[0])).child(div().flex_1().child(labels[1])).child(div().w(18).flex_none()))
      .children(rows.map((r) => {
        const empty = !this.filled(r);
        const file = kind === "form" && this.bodyType === "multipart" && r.value.value().startsWith("@");
        return h_flex().id(`${kind}-${r.id}`).w_full().px(4).gap(8).items_center().when(!r.on && !empty, (el) => el.opacity(0.45))
          .child(div().id(`${kind}-on-${r.id}`).size(16).flex_none().rounded(4).border_1().flex().items_center().justify_center()
            .border_color(r.on && !empty ? t.accent : t.border).bg(r.on && !empty ? t.accent : t.background)
            .text_size(11).font_semibold().text_color("#ffffff").cursor_pointer()
            .on_mouse_down("left", stop).on_click((_e, cx) => { if (!empty) this.toggleRow(r, cx); }).child(r.on && !empty ? "✓" : ""))
          .child(div().w(KEY_W).flex_none().child(cell(`${kind}-k-${r.id}`, r.key)))
          .child(h_flex().flex_1().min_w(0).gap(6).items_center()
            .child(div().flex_1().min_w(0).child(cell(`${kind}-v-${r.id}`, r.value)))
            .when(file, (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(9).bg(t.selected).text_size(10.5).text_color(t.muted).child("file"))))
          .child(div().id(`${kind}-x-${r.id}`).w(18).flex_none().text_size(13).text_color(t.dim)
            .when(!empty, (el) => el.cursor_pointer().hover((s) => s.text_color(t.blocked)).on_mouse_down("left", stop).on_click((_e, cx) => this.dropRow(r, cx)).child("×")));
      }));
  }

  render() {
    const t = theme();
    return v_flex().id("http-root").relative().size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .child(this.bar(t))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .when(this.side, (el) => el.child(v_flex().id("http-side").w(SIDE_W).flex_none().min_h(0).border_r(1).border_color(t.border)
          .child(v_flex().id("http-side-projects").flex_1().min_h(0).py(10).overflow_y_scrollbar().child(this.projectsView(t)))
          .child(this.varsView(t))))
        .child(v_flex().id("http-main").flex_1().min_w(0).min_h(0).p(16).gap(16).overflow_y_scrollbar()
          .child(this.titleView(t))
          .child(this.requestView(t))
          .child(this.responseView(t))))
      .child(this.footer(t))
      .when(this.menu, (el) => el.child(this.methodMenu(t)));
  }

  bar(t) {
    const preview = this.urlPreview(t);
    return v_flex().flex_none().px(12).py(10).gap(6).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(this.icon(t, "side", this.side ? "◧" : "☰", (cx) => this.toggleSide(cx)))
        .child(h_flex().flex_1().min_w(0).h(34).items_center().rounded(8).border_1().border_color(t.border).bg(t.background)
          .child(h_flex().id("m-pick").h_full().w(96).flex_none().px(10).gap(6).items_center().justify_between().border_r(1).border_color(t.border)
            .font_family(MONO).text_size(12.5).font_semibold().text_color(methodColor(this.method, t)).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_mouse_down("left", stop).on_click((_e, cx) => { this.menu = !this.menu; cx.notify(); })
            .child(this.method).child(div().text_color(t.dim).text_size(10).child("▾")))
          .child(div().flex_1().min_w(0).h_full().px(10).flex().items_center().font_family(MONO).text_size(12.5).child(Input.new(this.url).flex_1().h_full())))
        .child(this.button(t, "send", this.sending ? "Sending…" : "Send  ⌘↵", (cx) => this.send(cx), { primary: true, enabled: !this.sending })))
      .when(Boolean(preview), (el) => el.child(preview));
  }

  urlPreview(t) {
    const raw = this.url.value();
    if (!varsIn(raw).length) return null;
    const { r } = this.resolved();
    return h_flex().pl(36).gap(6).items_center().text_size(11).font_family(MONO)
      .child(div().flex_none().text_color(t.dim).child("→"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.url))
      .when(r.missing.length > 0, (el) => el.child(div().flex_none().text_color(t.blocked).child(`no value: ${r.missing.join(", ")}`)));
  }

  titleView(t) {
    const o = this.openReq;
    return h_flex().gap(10).items_center()
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center().min_w(0)
          .when(Boolean(o), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(`${o.project} /`)))
          .child(div().min_w(0).truncate().text_size(14).font_semibold().child(o ? o.name : "Unsaved request")))
        .when(Boolean(this.notes), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(this.notes))))
      .child(this.button(t, "curl", "Copy as curl", (cx) => this.copyCurl(cx), { small: true }))
      .child(this.button(t, "new", "+ New", (cx) => this.newRequest(cx), { small: true }));
  }

  methodMenu(t) {
    return v_flex().absolute().top(48).left(48).w(130).p(4).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .children(METHODS.map((m) => h_flex().id(`m-${m}`).h(28).px(10).items_center().rounded(5).font_family(MONO).text_size(12).font_semibold().cursor_pointer()
        .text_color(methodColor(m, t))
        .when(m === this.method, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.pickMethod(m, cx)).child(m)));
  }

  nameRow(t, id, hint, pad) {
    return v_flex().mx(8).pl(pad).gap(2)
      .child(h_flex().id(id).h(28).px(8).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background)
        .on_mouse_down("left", stop).child(Input.new(this.nameInput).flex_1().h_full().text_size(12)))
      .child(div().px(4).text_size(10.5).text_color(t.dim).child(hint));
  }

  sectionHead(t, text, ...actions) {
    return h_flex().px(14).pb(4).gap(4).items_center()
      .child(div().flex_1().text_size(10.5).font_semibold().text_color(t.dim).child(text))
      .children(actions);
  }

  projectsView(t) {
    const n = this.naming;
    const rows = [];
    if (n?.kind === "project") rows.push(this.nameRow(t, "p-name", "Project name · Enter · Esc", 0));
    if (!this.projects.length && n?.kind !== "project") rows.push(div().px(14).text_size(12).text_color(t.dim).child("+ to create a project, or ask the agent"));
    this.projects.forEach((p, k) => {
      rows.push(h_flex().id(`proj-${k}`).mx(8).px(6).h(28).gap(6).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => { p.open = !p.open; cx.notify(); })
        .child(div().w(10).flex_none().text_size(9).text_color(t.dim).child(p.open ? "▼" : "▶"))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().child(p.name))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(p.requests.length)))
        .child(this.icon(t, `proj-add-${k}`, "+", (cx) => this.startNaming("request", p.name, cx))));
      if (!p.open) return;
      if (n?.kind === "request" && n.project === p.name) rows.push(this.nameRow(t, `r-name-${k}`, `Request name in ${p.name} · Enter · Esc`, 16));
      p.requests.forEach((r, j) => {
        const on = this.openReq?.project === p.name && this.openReq?.name === r.name;
        rows.push(h_flex().id(`req-${k}-${j}`).mx(8).pl(22).pr(4).h(28).gap(8).items_center().rounded(6).cursor_pointer()
          .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(on ? t.selected : t.hover))
          .on_mouse_down("left", stop).on_click((_e, cx) => cx.spawn(async (cx) => this.openRequest(p.name, r.name, cx)))
          .child(div().w(44).flex_none().font_family(MONO).text_size(10).font_semibold().text_color(methodColor(r.method, t)).child(r.method === "DELETE" ? "DEL" : r.method === "OPTIONS" ? "OPT" : r.method))
          .child(div().flex_1().min_w(0).truncate().text_size(12).when(on, (el) => el.font_semibold()).child(r.name))
          .child(this.icon(t, `req-x-${k}-${j}`, "×", (cx) => this.trashRequest(p.name, r.name, cx))));
      });
    });
    return v_flex().w_full().gap(1)
      .child(this.sectionHead(t, "PROJECTS", this.icon(t, "p-new", "+", (cx) => this.startNaming("project", null, cx))))
      .children(rows);
  }

  varsView(t) {
    const n = this.naming;
    const scope = this.scope ? this.scope : "unsaved requests";
    return v_flex().id("http-vars").flex_none().max_h(260).py(10).gap(2).border_t(1).border_color(t.border).overflow_y_scrollbar()
      .child(this.sectionHead(t, `VARIABLES · ${scope}`,
        this.icon(t, "v-new", "+", (cx) => this.startNaming("var", null, cx)),
        ...(this.varRows.length ? [this.icon(t, "v-clear", "Clear", (cx) => this.clearVars(cx))] : [])))
      .when(n?.kind === "var", (el) => el.child(this.nameRow(t, "v-name", "Variable name · Enter · Esc", 0)))
      .when(!this.varRows.length && n?.kind !== "var", (el) => el.child(div().px(14).text_size(11.5).text_color(t.dim).child("Set from a response (the Vars tab), or + to type one. Use them as {{name}}.")))
      .children(this.varRows.map((v, i) => h_flex().id(`var-${i}`).mx(8).px(6).h(28).gap(6).items_center().rounded(6).hover((s) => s.bg(t.hover))
        .child(div().w(78).flex_none().truncate().font_family(MONO).text_size(11).text_color(t.accent).child(v.name))
        .child(h_flex().id(`var-in-${i}`).flex_1().min_w(0).h(22).px(6).items_center().rounded(5).border_1().border_color(t.border).bg(t.background)
          .on_mouse_down("left", stop).child(Input.new(v.input).flex_1().h_full().font_family(MONO).text_size(11)))
        .child(this.icon(t, `var-x-${i}`, "×", (cx) => this.dropVar(v.name, cx)))));
  }

  tabs(t, prefix, items, current, pick) {
    return h_flex().w_full().gap(2).border_b(1).border_color(t.border)
      .children(items.map(({ id, label, badge }) => {
        const on = current === id;
        return h_flex().id(`${prefix}-${id}`).h(32).px(12).gap(6).items_center().border_b(2).border_color(on ? t.accent : t.popover)
          .text_size(12.5).text_color(on ? t.foreground : t.muted).when(on, (el) => el.font_semibold()).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => pick(id, cx))
          .child(label)
          .when(badge !== null && badge !== undefined && badge !== "", (el) => el.child(div().px(6).h(16).flex().items_center().rounded(8).bg(t.selected).text_size(10).text_color(t.muted).child(String(badge))));
      }));
  }

  requestView(t) {
    const count = (kind) => this.rows[kind].filter((r) => r.on && this.filled(r)).length || null;
    const type = BODY_TYPES.find((b) => b.id === this.bodyType);
    const items = [
      { id: "params", label: "Params", badge: count("param") },
      { id: "headers", label: "Headers", badge: count("header") },
      { id: "body", label: "Body", badge: this.bodyType === "none" ? null : type.label },
      { id: "vars", label: "Vars", badge: count("set") },
    ];
    return v_flex().w_full().gap(12)
      .child(this.tabs(t, "qt", items, this.reqTab, (id, cx) => { this.reqTab = id; cx.notify(); }))
      .child(this.reqTab === "params" ? this.table(t, "param", ["NAME", "VALUE"])
        : this.reqTab === "headers" ? v_flex().gap(8).child(this.table(t, "header", ["HEADER", "VALUE"]))
          .when(Boolean(type?.type) && hasBody(this.method) && !this.live("header").some((h) => h.on && h.key.toLowerCase() === "content-type"),
            (el) => el.child(this.hint(t, `Content-Type: ${type.type} is added from the body type.`)))
        : this.reqTab === "body" ? this.bodyView(t)
        : this.setView(t));
  }

  bodyView(t) {
    const seg = h_flex().p(2).gap(2).rounded(7).bg(t.background).border_1().border_color(t.border)
      .children(BODY_TYPES.map((b) => {
        const on = this.bodyType === b.id;
        return div().id(`bt-${b.id}`).h(24).px(10).flex().items_center().rounded(5).text_size(12).cursor_pointer()
          .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).when(on, (el) => el.font_semibold())
          .hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => this.pickBodyType(b.id, cx)).child(b.label);
      }));
    const head = h_flex().gap(10).items_center().child(seg).child(div().flex_1())
      .when(this.bodyType === "json", (el) => el.child(this.button(t, "fmt", "Format", (cx) => this.formatBody(cx), { small: true })));
    const out = v_flex().w_full().gap(10).child(head);
    if (!hasBody(this.method) && this.bodyType !== "none") out.child(this.hint(t, `Not sent with ${this.method}.`));
    if (this.bodyType === "none") return out.child(this.hint(t, "No body."));
    if (this.bodyType === "form") return out.child(this.table(t, "form", ["FIELD", "VALUE"])).child(this.hint(t, "Sent as application/x-www-form-urlencoded."));
    if (this.bodyType === "multipart") return out.child(this.table(t, "form", ["FIELD", "VALUE"])).child(this.hint(t, "A value starting with @ is a file: @~/Downloads/photo.png."));
    return out.child(div().id("f-body").w_full().min_w(0).rounded(8).border_1().border_color(t.border).bg(t.background).font_family(MONO).text_size(12)
      .on_mouse_down("left", stop).child(Textarea.new(this.body).w_full()));
  }

  setView(t) {
    return v_flex().w_full().gap(10)
      .child(this.hint(t, "After the response, set these variables for the next requests, used as {{variable}}."))
      .child(this.table(t, "set", ["VARIABLE", "FROM THE RESPONSE"]))
      .child(v_flex().gap(2).text_size(11).font_family(MONO).text_color(t.dim)
        .child("body.data.token   body.items[0].id   body   header.Location   status"));
  }

  responseView(t) {
    const r = this.response;
    const card = () => v_flex().w_full().rounded(10).border_1().border_color(t.border).bg(t.background);
    const empty = (text, color = t.dim) => card().p(16).gap(6).child(div().text_size(10.5).font_semibold().text_color(t.dim).child("RESPONSE")).child(div().text_color(color).text_size(12.5).child(text));
    if (this.sending) return empty("Waiting for the answer…");
    if (!r) return empty(kbd("Send the request (⌘↵) to see its answer here."));
    if (r.error) return empty(r.error, t.blocked).font_family(MONO);
    const body = r.binary ? `_${r.type || "binary"} body, ${sizeText(r.size)}: not shown_`
      : !r.body.text ? "_Empty body_"
      : r.body.text.length > SHOW_MAX ? `\`\`\`\n${r.body.text.slice(0, SHOW_MAX)}\n\`\`\`\n\n_Cut at ${sizeText(SHOW_MAX)}: copy the body to see it all._`
      : `\`\`\`${["json", "xml", "html"].includes(r.body.kind) ? r.body.kind : ""}\n${r.body.text}\n\`\`\``;
    const set = r.set?.names?.length ? r.set.names : null;
    return card()
      .child(h_flex().px(14).pt(12).gap(10).items_center()
        .child(div().h(24).px(10).rounded(12).bg(statusColor(r.status, t)).text_size(12).font_semibold().text_color("#ffffff").flex().items_center()
          .child(r.statusLine.replace(/^HTTP\/[\d.]+\s*/, "") || String(r.status)))
        .child(div().text_size(12).text_color(t.muted).child(`${r.ms} ms · ${sizeText(r.size)}${r.redirects ? ` · ${r.redirects} redirect${r.redirects > 1 ? "s" : ""}` : ""}`))
        .child(div().flex_1())
        .when(!r.binary && Boolean(r.body.text), (el) => el.child(this.button(t, "copy-body", "Copy body", (cx) => this.copyBody(cx), { small: true }))))
      .when(Boolean(set), (el) => el.child(h_flex().px(14).pt(8).gap(6).items_center().text_size(11.5).text_color(t.done)
        .child("✓ set").children(set.map((n) => div().px(6).h(18).flex().items_center().rounded(9).bg(t.selected).font_family(MONO).text_size(11).text_color(t.accent).child(n)))))
      .child(div().px(8).pt(6).child(this.tabs(t, "rt", [{ id: "body", label: "Body" }, { id: "headers", label: "Headers", badge: r.headers.length }], this.view, (id, cx) => { this.view = id; cx.notify(); })))
      .child(div().px(14).py(12).child(this.view === "headers"
        ? v_flex().w_full().gap(3).font_family(MONO).text_size(12).children(r.headers.map(([k, v], n) => h_flex().id(`rh-${n}`).gap(10).items_start()
          .child(div().w(200).flex_none().truncate().text_color(t.muted).child(k)).child(div().flex_1().min_w(0).child(v))))
        : TextView.markdown(`resp-${r.at}`, body).selectable()));
  }

  footer(t) {
    const s = this.status;
    const color = s ? (s.level === "error" ? t.blocked : s.level === "success" ? t.done : t.muted) : t.dim;
    const idle = this.openReq ? "Saves itself as you edit · ⌘↵ send · ⌘⇧C copy as curl · {{name}} uses a variable" : "⌘↵ send · ⌘⇧C copy as curl · + beside a project saves the request in it · {{name}} uses a variable";
    return h_flex().h(26).flex_none().px(12).items_center().border_t(1).border_color(t.border).text_size(11)
      .child(div().flex_1().min_w(0).truncate().text_color(color).child(kbd(s?.text ?? idle)));
  }
}
