import { View, div } from "gpui-kit";
import { props, closeOverlay, panes, run } from "herdr";

export default class VsCodeLauncher extends View {
  init(_props, cx) {
    cx.timer.after(0, () => {
      closeOverlay(props().overlay);
      const focused = panes().find((p) => p.focused);
      const open = panes().find((p) => p.mod === "vscode" && p.tab === focused?.tab);
      if (open) run("pane.focus", { pane: open.pane });
      else run("pane.split", { direction: "right", mod: "vscode", props: { folder: focused?.cwd ?? undefined } });
    });
  }

  render() {
    return div();
  }
}
