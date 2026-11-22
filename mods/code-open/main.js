import { View, div } from "gpui-kit";
import { props, closeOverlay, run, panes, spaces, focused, exec, home } from "herdr";

export default class CodeOpen extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      try {
        await this.open();
      } finally {
        closeOverlay(props().overlay);
      }
    });
  }

  async open() {
    const folder = focused()?.cwd ?? home();
    const top = await exec("git", ["-C", folder, "rev-parse", "--show-toplevel"]);
    const root = top.code === 0 ? top.stdout.trim() : folder;
    const name = `Code · ${root.split("/").pop()}`;
    for (const space of spaces()) {
      const tab = space.tabs.find((candidate) => candidate.name === name && panes().some((pane) => pane.tab === candidate.id && pane.mod === "code"));
      if (tab) {
        run("space.select", { id: space.id });
        run("tab.select", { id: tab.id });
        return;
      }
    }
    run("tab.new", { name, mod: "code", props: { root } });
  }

  render() {
    return div();
  }
}
