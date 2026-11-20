import { View, div } from "gpui-kit";
import { props, closeOverlay, run, focused, panes, spaces } from "herdr";

const TAB = "Linear";

export default class LinearCurrent extends View {
  init(_props, cx) {
    cx.timer.after(0, () => {
      const f = focused();
      const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
      const tab = spaces().flatMap((s) => s.tabs).find((x) => x.id === f?.tab);
      closeOverlay(props().overlay);
      if (!f?.tab || tab?.name === TAB) return;
      const open = panes().find((p) => p.tab === f.tab && p.mod === "linear");
      if (open) { run("pane.close", { pane: open.pane }); return; }
      const origin = { branch: pane?.branch ?? null, cwd: pane?.cwd ?? f?.cwd ?? null, terminal: pane?.terminal ?? f?.terminal ?? null, tab: f.tab };
      run("pane.split", { direction: "right", ...(pane ? { pane: pane.pane } : {}), mod: "linear", props: { open: "current", side: true, origin } });
    });
  }

  render() {
    return div();
  }
}
