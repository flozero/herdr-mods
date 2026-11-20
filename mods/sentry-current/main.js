import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay, focused, panes, spaces } from "herdr";

function place() {
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const tab = f?.tab ? spaces().flatMap((s) => s.tabs).find((x) => x.id === f.tab) : null;
  return [pane?.branch, (pane?.cwd ?? f?.cwd ?? "").split("/").pop(), tab?.name].filter(Boolean);
}

export default class SentryCurrent extends View {
  init(_props, cx) {
    const texts = place();
    cx.timer.after(0, () => {
      closeOverlay(props().overlay);
      openOverlay({ mod: "sentry", kind: "window", key: "sentry-current", width: 1000, height: 0.8, props: { open: "current", texts } });
    });
  }

  render() {
    return div();
  }
}
