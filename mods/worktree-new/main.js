import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay, spaces, panes } from "herdr";

export default class WorktreeLauncher extends View {
  init(_props, cx) {
    cx.timer.after(0, () => {
      closeOverlay(props().overlay);
      const space = spaces().find((s) => s.active);
      const folder = panes().find((p) => p.focused && p.cwd)?.cwd;
      openOverlay({ mod: "my-worktree", kind: "dialog", width: 800, height: 560, props: { space: space?.id, folder, action: "new" } });
    });
  }

  render() {
    return div();
  }
}
