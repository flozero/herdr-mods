import { View, div } from "gpui-kit";
import { props, closeOverlay, panes, run } from "herdr";

export default class HttpOpen extends View {
  init(_props, cx) {
    cx.timer.after(0, () => {
      closeOverlay(props().overlay);
      const focused = panes().find((p) => p.focused);
      if (focused?.mod === "http") return;
      const open = panes().find((p) => p.mod === "http" && p.tab === focused?.tab);
      if (open) run("pane.focus", { pane: open.pane });
      else run("pane.split", { direction: "right", mod: "http" });
    });
  }

  render() {
    return div();
  }
}
