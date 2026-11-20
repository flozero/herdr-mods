import { View, div } from "gpui-kit";
import { props, closeOverlay, run, panes, spaces } from "herdr";

const NAME = "Sentry";

export default class SentryOpen extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      try { this.open(); } finally { closeOverlay(props().overlay); }
    });
  }

  open() {
    for (const s of spaces()) {
      const tab = s.tabs.find((tb) => tb.name === NAME && panes().some((p) => p.tab === tb.id && p.mod === "sentry"));
      if (tab) {
        run("space.select", { id: s.id });
        run("tab.select", { id: tab.id });
        return;
      }
    }
    run("tab.new", { name: NAME, mod: "sentry" });
  }

  render() {
    return div();
  }
}
