import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, run, focused, panes, spaces, exec, theme } from "herdr";

const LIST = "MRs · ";
const BRANCH = "Review · ";
const ROW_H = 36;
const base = (path) => (path ?? "").split("/").pop() || "?";

function focusedCwd() {
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return pane?.cwd ?? f?.cwd ?? spaces().find((s) => s.active)?.folder ?? null;
}

function reviewTabs() {
  const out = [];
  for (const s of spaces()) {
    for (const tab of s.tabs) {
      if ((tab.name.startsWith(LIST) || tab.name.startsWith(BRANCH)) && panes().some((p) => p.tab === tab.id && p.mod === "gitlab-review")) out.push({ space: s, tab });
    }
  }
  return out;
}

export default class GitlabReviewOpen extends View {
  init(_props, cx) {
    this.choices = props()?.choices ?? null;
    this.sel = 0;
    this.handle = cx.focus_handle();
    if (this.choices) { cx.timer.after(0, () => this.handle.focus()); return; }
    const cwd = focusedCwd();
    cx.spawn(async () => {
      try { await this.open(cwd); } finally { closeOverlay(props().overlay); }
    });
  }

  async open(cwd) {
    const git = (dir, args) => exec("git", ["-C", dir, ...args]).catch(() => null);
    const r = cwd ? await git(cwd, ["rev-parse", "--show-toplevel"]) : null;
    const top = r?.code === 0 ? r.stdout.trim() : null;
    const common = top ? await git(top, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) : null;
    const repo = common?.code === 0 ? common.stdout.trim().replace(/\/\.git$/, "") : top;
    const branch = top ? (await git(top, ["branch", "--show-current"]))?.stdout.trim() || "HEAD" : null;
    const tabs = reviewTabs();
    const tabNamed = (name) => tabs.find((x) => x.tab.name === name);
    const here = top ? [
      { kind: "branch", title: `Branch ${branch}`, where: base(top), name: `${BRANCH}${base(top)}`, cwd: top },
      { kind: "list", title: "All merge requests", where: base(repo), name: `${LIST}${base(repo)}`, cwd: top },
    ].map((c) => {
      const open = tabNamed(c.name);
      return open ? { ...c, space: open.space.id, tab: open.tab.id } : c;
    }) : [];
    const others = tabs.filter((x) => !here.some((c) => c.name === x.tab.name))
      .map((x) => ({ kind: "go", title: `Go to ${x.tab.name}`, where: x.space.name, space: x.space.id, tab: x.tab.id }));
    const choices = [...here, ...others];
    if (!choices.length) return;
    openOverlay({ mod: "gitlab-review-open", kind: "dialog", width: 480, height: 96 + ROW_H * choices.length, props: { choices } });
  }

  go(space, tab) {
    run("space.select", { id: space });
    run("tab.select", { id: tab });
  }

  choose(c) {
    if (!c) return;
    if (c.tab) this.go(c.space, c.tab);
    else run("tab.new", { name: c.name, mod: "gitlab-review", props: { cwd: c.cwd, ...(c.kind === "branch" ? { local: true } : {}) } });
    closeOverlay(props().overlay);
  }

  onKey(e, cx) {
    const k = e.keystroke, n = this.choices.length;
    if (k === "down" || k === "tab") this.sel = (this.sel + 1) % n;
    else if (k === "up" || k === "shift-tab") this.sel = (this.sel + n - 1) % n;
    else if (k === "enter") this.choose(this.choices[this.sel]);
    else if (/^[1-9]$/.test(k) && Number(k) <= n) this.choose(this.choices[Number(k) - 1]);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    if (!this.choices) return div();
    const t = theme();
    return v_flex().id("gro-root").size_full().p(14).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .child(div().text_size(14).font_semibold().child("Review"))
      .child(v_flex().gap(2).children(this.choices.map((c, n) => {
        const on = n === this.sel;
        return h_flex().id(`gro-${n}`).h(ROW_H).px(10).gap(10).items_center().rounded(8).cursor_pointer()
          .bg(on ? t.selected : t.popover).hover((s) => s.bg(on ? t.selected : t.hover))
          .on_click(() => this.choose(c))
          .child(div().w(14).flex_none().text_size(11).text_color(t.dim).child(String(n + 1)))
          .child(div().flex_none().font_semibold().child(c.title))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(c.where ?? ""))
          .when(Boolean(c.tab) && c.kind !== "go", (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")));
      })))
      .child(div().text_size(11).text_color(t.dim).child("↑↓ choose · Enter or 1–9 · Esc cancel"));
  }
}
