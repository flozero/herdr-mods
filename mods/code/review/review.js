import { hc, run, panes, terminals, focused } from "herdr";

export const CHANGE_COLORS = { added: "#22c55e", modified: "#3b82f6", deleted: "#ef4444" };
export const COMMENT_COLOR = "#f59e0b";

export function changeBlocks(rows) {
  const blocks = [];
  let adds = [];
  let deleted = null;
  const flush = () => {
    if (adds.length) blocks.push({ kind: deleted === null ? "added" : "modified", start: adds[0], end: adds[adds.length - 1] });
    else if (deleted !== null) blocks.push({ kind: "deleted", start: deleted, end: deleted });
    adds = [];
    deleted = null;
  };
  for (const row of rows ?? []) {
    if (row.kind === "add") adds.push(row.new);
    else if (row.kind === "del") deleted ??= row.newPos;
    else flush();
  }
  flush();
  return blocks;
}

export function changeAt(rows, line) {
  let dels = [];
  let adds = [];
  let found = null;
  const flush = () => {
    if (!found && dels.length) {
      const start = adds.length ? adds[0] : dels[0].newPos;
      const end = adds.length ? adds[adds.length - 1] : start;
      if (line >= start && line <= end) found = { start, end, oldStart: dels[0].old, old: dels.map((row) => row.text), added: adds.length };
    }
    dels = [];
    adds = [];
  };
  for (const row of rows ?? []) {
    if (row.kind === "del") {
      if (adds.length) flush();
      dels.push(row);
    } else if (row.kind === "add") adds.push(row.new);
    else flush();
  }
  flush();
  return found;
}

export const lineRange = (start, end) => ({ start: { line: start - 1, character: 0 }, end: { line: end, character: 0 } });

export function changeHighlights(rows) {
  return changeBlocks(rows).map((block) => ({
    range: lineRange(block.start, block.kind === "deleted" ? block.start : block.end),
    color: CHANGE_COLORS[block.kind],
    style: "gutter",
  }));
}

export const where = (comment) => `${comment.path}:${comment.start === comment.end ? comment.start : `${comment.start}-${comment.end}`}`;

export function reviewPrompt({ branch, base }, comments) {
  const head = `Review of my local changes on ${branch}${base ? ` (against ${base})` : ""}: ${comments.length} comment${comments.length > 1 ? "s" : ""}. Address each one, then tell me what you changed.`;
  const parts = comments.map((comment, index) => `${index + 1}. ${where(comment)}\n\`\`\`\n${comment.code}\n\`\`\`\n${comment.note}`);
  return [head, ...parts].join("\n\n");
}

export class AgentSession {
  constructor(root, command, sleep) {
    this.root = root;
    this.command = command;
    this.sleep = sleep;
    this.address = null;
  }

  alive() {
    return Boolean(this.address) && terminals().some((terminal) => terminal.address === this.address && terminal.state === "live");
  }

  openAgent() {
    const inRoot = (cwd) => cwd === this.root || cwd?.startsWith(`${this.root}/`);
    const live = new Set(terminals().filter((terminal) => terminal.state === "live").map((terminal) => terminal.address));
    const tab = focused()?.tab;
    const rank = (pane) => (pane.tab === tab ? 0 : 2) + (pane.status === "working" ? 1 : 0);
    return panes().filter((pane) => pane.terminal && pane.status && live.has(pane.terminal) && inRoot(pane.cwd))
      .sort((a, b) => rank(a) - rank(b))[0]?.terminal ?? null;
  }

  async send(text) {
    if (!this.alive()) this.address = this.openAgent();
    if (this.alive()) {
      const sent = await hc(["send", this.address, text]);
      if (sent.code !== 0) throw new Error((sent.stderr || sent.stdout || "").trim() || "hc send failed");
    } else {
      const name = `code-review-${Date.now().toString(36)}`;
      const started = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name, "--cwd", this.root, "--", ...this.command, text]);
      if (started.code !== 0) throw new Error((started.stderr || started.stdout).trim());
      this.address = JSON.parse(started.stdout).address ?? name;
    }
    return this.showRight();
  }

  async showRight() {
    const shown = () => panes().some((pane) => pane.terminal === this.address);
    for (let attempt = 0; attempt < 40 && !shown(); attempt++) {
      if (attempt % 4 === 0 && this.alive()) run("terminal.keep", { terminal: this.address, place: "right" });
      await this.sleep(250);
    }
    return shown();
  }
}
