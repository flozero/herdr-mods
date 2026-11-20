import { View, div } from "gpui-kit";
import { props, closeOverlay, run, panes, spaces } from "herdr";

const NAME = "HTTP";

export default class HttpOpen extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      try { this.open(); } finally { closeOverlay(props().overlay); }
    });
  }

  open() {
    for (const s of spaces()) {
      const tab = s.tabs.find((tb) => tb.name === NAME && panes().some((p) => p.tab === tb.id && p.mod === "http"));
      if (tab) {
        run("space.select", { id: s.id });
        run("tab.select", { id: tab.id });
        return;
      }
    }
    run("tab.new", { name: NAME, mod: "http" });
  }

  render() {
    return div();
  }
}
