import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor, EditorState, ScrollHandle } from "gpui-base";
import { theme, props, focused, exec, home, appHome, readTextFile, writeTextFile, closeOverlay, run, watchFolder } from "herdr";
import { launch, fileUri, uriPath } from "./lsp.js";
import { branchDiff, agentLabel } from "./review/local.js";
import { lineDiff } from "./review/diff.js";
import { findReview, publishReview } from "./review/forge.js";
import { AgentSession, CHANGE_COLORS, COMMENT_COLOR, changeAt, changeHighlights, lineRange, reviewPrompt, where } from "./review/review.js";

const MONO = "JetBrains Mono";
const SHOWN_FILES = 200;
const SIDE_W = 300;
const SIDE_MIN = 160;
const SIDE_MAX = 900;
const REFERENCES_LIMIT = 500;
const MOD_DIR = () => `${appHome()}/mods/code`;
const CACHE_DIR = () => `${home()}/.cache/herdr-code`;
const SERVERS_DIR = () => `${CACHE_DIR()}/servers`;
const stop = (_e, cx) => cx.stop_propagation();

const ACTIONS = [
  { id: "files", key: "ctrl-p", label: "Find a file", run: (view) => view.focusFinder() },
  { id: "search", key: "cmd-shift-f", aliases: ["ctrl-shift-f"], label: "Find and replace in the project", run: (view) => view.startGrep() },
  { id: "sidebar", key: "ctrl-b", label: "Show or hide the sidebar", run: (view) => view.toggleSidebar() },
  { id: "changes", key: "ctrl-shift-g", label: "Switch between files and changes", run: (view) => view.toggleChanges() },
  { id: "comment", key: "ctrl-k", label: "Comment the selected lines", run: (view) => view.startComment() },
  { id: "send", key: "ctrl-enter", label: "Send the review to the agent", run: (view) => view.sendReview() },
  { id: "publish", key: "ctrl-shift-enter", label: "Publish the review on the MR/PR", run: (view) => view.publish() },
  { id: "save", key: "ctrl-s", label: "Save", run: (view) => view.save() },
  { id: "close", key: "ctrl-w", label: "Close the tab", run: (view) => view.current && view.closeTab(view.current.path) },
  { id: "definition", key: "f12", label: "Go to definition", run: (view) => view.goToDefinition() },
  { id: "find", key: "cmd-f", aliases: ["ctrl-f"], label: "Find in the file", run: (view) => view.startFind() },
  { id: "references", key: "shift-f12", label: "Show where it is used", run: (view) => view.findReferences() },
  { id: "back", key: "ctrl--", label: "Go back", run: (view) => view.goBack() },
  { id: "forward", key: "ctrl-=", aliases: ["ctrl-+", "ctrl-shift-="], label: "Go forward", run: (view) => view.goForward() },
  { id: "nextTab", key: "ctrl-alt-right", label: "Next tab", run: (view) => view.cycleTab(1) },
  { id: "previousTab", key: "ctrl-alt-left", label: "Previous tab", run: (view) => view.cycleTab(-1) },
  { id: "shortcuts", key: "ctrl-/", label: "Show the shortcuts", run: (view) => view.toggleShortcuts() },
];

const FIXED_SHORTCUTS = [["cmd-click", "Go to definition"], ["ctrl-click, right click", "Show where it is used"], ["escape", "Back to the editor, or cancel"]];

const KEY_SYMBOLS = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", enter: "⏎", escape: "Esc", left: "←", right: "→", up: "↑", down: "↓", tab: "⇥", click: " click" };

const keyLabel = (key) => {
  if (!key) return "none";
  const minus = key.endsWith("--");
  const parts = (minus ? key.slice(0, -2) : key).split("-").filter(Boolean);
  if (minus) parts.push("-");
  return parts.map((part) => KEY_SYMBOLS[part] ?? part.toUpperCase()).join("");
};

const keymapOf = (overrides) => {
  const keymap = new Map();
  for (const action of ACTIONS) {
    const key = Object.hasOwn(overrides, action.id) ? overrides[action.id] : action.key;
    if (key) keymap.set(String(key), action);
    if (!Object.hasOwn(overrides, action.id)) for (const alias of action.aliases ?? []) keymap.set(alias, action);
  }
  return keymap;
};

const NPM_SERVERS = ["@vtsls/language-server", "@vue/language-server", "@vue/typescript-plugin", "bash-language-server"];
const TOFU_LS_VERSION = "0.5.3";
const INSTALL_TOFU_LS = [
  'set -e; dir=$(mktemp -d); cd "$dir"',
  'os=$(uname -s); arch=$(uname -m); [ "$arch" = aarch64 ] && arch=arm64',
  'archive="tofu-ls_${os}_${arch}.tar.gz"; base="https://github.com/opentofu/tofu-ls/releases/download/v$2"',
  'curl -fsSLO "$base/$archive"; curl -fsSLO "$base/tofu-ls_$2_checksums.txt"',
  'grep " $archive$" "tofu-ls_$2_checksums.txt" | shasum -a 256 -c - >/dev/null',
  'tar -xzf "$archive"; mkdir -p "$1/bin"; mv tofu-ls "$1/bin/tofu-ls"; cd /; rm -rf "$dir"',
].join("\n");

const SERVERS = {
  python: { command: () => ["uvx", "ty", "server"] },
  rust: { command: () => ["rust-analyzer"], install: "rustup", workspace: "Cargo.toml" },
  go: { command: () => ["gopls"] },
  opentofu: { command: () => [`${SERVERS_DIR()}/bin/tofu-ls`, "serve"], install: "tofu-ls" },
  typescript: { command: () => [`${SERVERS_DIR()}/node_modules/.bin/vtsls`, "--stdio"], install: "npm" },
  vue: { command: () => [`${SERVERS_DIR()}/node_modules/.bin/vue-language-server`, "--stdio"], install: "npm" },
  bash: { command: () => [`${SERVERS_DIR()}/node_modules/.bin/bash-language-server`, "start"], install: "npm" },
};

const typescriptSettings = () => ({
  vtsls: {
    tsserver: {
      globalPlugins: [{
        name: "@vue/typescript-plugin",
        location: SERVERS_DIR(),
        languages: ["vue"],
        configNamespace: "typescript",
        enableForWorkspaceTypeScriptVersions: true,
      }],
    },
  },
  typescript: {},
  javascript: {},
});

const TYPESCRIPT = (id) => ({ servers: ["typescript"], id, syntax: "js" });

const SHELL = { servers: ["bash"], id: "shellscript", syntax: "bash" };

const LANGUAGES = {
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  py: { servers: ["python"], id: "python" },
  pyi: { servers: ["python"], id: "python" },
  rs: { servers: ["rust"], id: "rust" },
  go: { servers: ["go"], id: "go" },
  tf: { servers: ["opentofu"], id: "opentofu" },
  tofu: { servers: ["opentofu"], id: "opentofu" },
  tfvars: { servers: ["opentofu"], id: "opentofu-vars" },
  ts: TYPESCRIPT("typescript"),
  mts: TYPESCRIPT("typescript"),
  cts: TYPESCRIPT("typescript"),
  tsx: TYPESCRIPT("typescriptreact"),
  js: TYPESCRIPT("javascript"),
  mjs: TYPESCRIPT("javascript"),
  cjs: TYPESCRIPT("javascript"),
  jsx: TYPESCRIPT("javascriptreact"),
  vue: { servers: ["typescript", "vue"], id: "vue", syntax: "html" },
};

const lookup = (settings, section) => (section ? section.split(".").reduce((value, key) => value?.[key], settings) : settings) ?? null;

const contextFor = (context, server) => {
  const triggers = server.capabilities.completionProvider?.triggerCharacters ?? [];
  return context.triggerKind === 2 && !triggers.includes(context.triggerCharacter) ? { triggerKind: 1 } : context;
};

const completionItems = (answer) => (Array.isArray(answer) ? answer : answer?.items ?? []);

const extensionOf = (path) => (/\.([^./]+)$/.exec(path)?.[1] ?? "").toLowerCase();

const shebangOf = (text) => /^#!\S*?\b(?:env\s+)?(sh|bash|zsh|dash|ksh)\b/.exec(text)?.[1] ?? null;

const FIND_LIMIT = 2000;
const GREP_LIMIT = 5000;
const GREP_DEBOUNCE = 500;
const REFERENCE_COLOR = "#eab30826";
const PEEK_BG = "#ef444412";
const DIFF_DELETED = "#ef44441a";
const DELETED_MARK = "\u2212 ";
const LIVE_DIFF_DELAY = 120;
const DIFF_ADDED = "#22c55e12";
const FIND_COLOR = "#eab30840";
const FIND_CURRENT_COLOR = "#eab308";

const positionsOf = (text, offsets) => {
  const order = offsets.map((offset, i) => [offset, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(offsets.length);
  let line = 0;
  let lineStart = 0;
  let at = 0;
  for (const [offset, i] of order) {
    for (; at < offset; at++) {
      if (text.charCodeAt(at) === 10) {
        line++;
        lineStart = at + 1;
      }
    }
    out[i] = { line, character: offset - lineStart };
  }
  return out;
};

const wordAt = (text, offset) => {
  const isWord = (at) => /[\p{L}\p{N}_$]/u.test(text[at] ?? "");
  let start = offset;
  let end = offset;
  while (start > 0 && isWord(start - 1)) start--;
  while (end < text.length && isWord(end)) end++;
  return text.slice(start, end);
};

const offsetOf = (text, { line, character }) => {
  let offset = 0;
  for (let row = 0; row < line; row++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  const end = text.indexOf("\n", offset);
  return Math.min(offset + character, end < 0 ? text.length : end);
};

const fuzzyScore = (haystack, query) => {
  let at = -1;
  let score = 0;
  for (let i = 0; i < query.length; i++) {
    const found = haystack.indexOf(query[i], at + 1);
    if (found < 0) return null;
    score += found - at;
    at = found;
  }
  return score + (haystack.endsWith(query) ? -50 : 0) + haystack.length / 100;
};

const positionOf = (text, offset) => {
  let line = 0;
  for (let at = text.indexOf("\n"); at !== -1 && at < offset; at = text.indexOf("\n", at + 1)) line++;
  return { line, character: offset - (text.lastIndexOf("\n", offset - 1) + 1) };
};

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

const OWN_ICON = (name) => `mods/code/icons/${name}.svg`;
const APP_ICON = (name) => `icons/${name}.svg`;

const ICON_BY_NAME = {
  "dockerfile": [APP_ICON("docker"), "#2496ED"],
  "docker-compose.yml": [APP_ICON("docker"), "#2496ED"],
  "docker-compose.yaml": [APP_ICON("docker"), "#2496ED"],
  "makefile": [APP_ICON("make"), "#6D8086"],
  "package.json": [APP_ICON("npm"), "#CB3837"],
  "go.mod": [APP_ICON("go"), "#00ADD8"],
  "go.sum": [APP_ICON("go"), "#00ADD8"],
  "cargo.toml": [APP_ICON("cargo"), "#DEA584"],
  "pyproject.toml": [APP_ICON("python"), "#3776AB"],
  "uv.lock": [APP_ICON("uv"), "#DE5FE9"],
  "yarn.lock": [APP_ICON("yarn"), "#2C8EBB"],
  "pnpm-lock.yaml": [APP_ICON("pnpm"), "#F69220"],
  ".gitignore": [APP_ICON("git"), "#F05032"],
  ".gitattributes": [APP_ICON("git"), "#F05032"],
  ".gitlab-ci.yml": [APP_ICON("glab"), "#FC6D26"],
};

const ICON_BY_EXTENSION = {
  py: [APP_ICON("python"), "#3776AB"],
  pyi: [APP_ICON("python"), "#3776AB"],
  go: [APP_ICON("go"), "#00ADD8"],
  tf: [APP_ICON("terraform"), "#7B42BC"],
  tfvars: [APP_ICON("terraform"), "#7B42BC"],
  hcl: [APP_ICON("terraform"), "#7B42BC"],
  ts: [APP_ICON("tsc"), "#3178C6"],
  tsx: [APP_ICON("tsc"), "#3178C6"],
  mts: [APP_ICON("tsc"), "#3178C6"],
  js: [APP_ICON("node"), "#D4B830"],
  mjs: [APP_ICON("node"), "#D4B830"],
  cjs: [APP_ICON("node"), "#D4B830"],
  jsx: [APP_ICON("node"), "#D4B830"],
  vue: [OWN_ICON("vue"), "#41B883"],
  rs: [APP_ICON("cargo"), "#DEA584"],
  sh: [APP_ICON("shell"), "#4EAA25"],
  bash: [APP_ICON("shell"), "#4EAA25"],
  zsh: [APP_ICON("shell"), "#4EAA25"],
  sql: [APP_ICON("psql"), "#336791"],
  rb: [APP_ICON("ruby"), "#CC342D"],
  php: [APP_ICON("php"), "#777BB4"],
  java: [APP_ICON("java"), "#E76F00"],
  kt: [APP_ICON("kotlin"), "#7F52FF"],
  lua: [APP_ICON("lua"), "#2C2D72"],
  swift: [APP_ICON("swift"), "#F05138"],
  dart: [APP_ICON("dart"), "#0175C2"],
  zig: [APP_ICON("zig"), "#F7A41D"],
  json: [OWN_ICON("braces"), "#CB8E00"],
  jsonc: [OWN_ICON("braces"), "#CB8E00"],
  md: [OWN_ICON("text"), "#519ABA"],
  txt: [OWN_ICON("text"), "#8A8F98"],
  yml: [OWN_ICON("text"), "#CB171E"],
  yaml: [OWN_ICON("text"), "#CB171E"],
  toml: [OWN_ICON("text"), "#9C4221"],
  html: [OWN_ICON("file"), "#E34C26"],
  css: [OWN_ICON("file"), "#563D7C"],
  scss: [OWN_ICON("file"), "#C6538C"],
  svg: [OWN_ICON("file"), "#FFB13B"],
  png: [OWN_ICON("file"), "#A074C4"],
  jpg: [OWN_ICON("file"), "#A074C4"],
};

const fileIcon = (path) => ICON_BY_NAME[basename(path).toLowerCase()] ?? ICON_BY_EXTENSION[extensionOf(path)] ?? [OWN_ICON("file"), null];

const iconElement = ([path, color], fallback) => svg(path).size(14).flex_none().text_color(color ?? fallback);

const byName = (a, b) => a.name.localeCompare(b.name);

const buildTree = (paths) => {
  const root = { name: "", path: "", folders: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    for (const name of parts.slice(0, -1)) {
      if (!node.folders.has(name)) {
        node.folders.set(name, { name, path: node.path ? `${node.path}/${name}` : name, folders: new Map(), files: [] });
      }
      node = node.folders.get(name);
    }
    node.files.push({ name: parts[parts.length - 1], path });
  }
  const settle = (node) => {
    node.folders = [...node.folders.values()].sort(byName);
    node.files.sort(byName);
    node.folders.forEach(settle);
    return node;
  };
  return settle(root);
};

const ancestorsOf = (path) => path.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));

function hoverText(contents) {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).join("\n\n");
  if (contents?.language) return `\`\`\`${contents.language}\n${contents.value}\n\`\`\``;
  return contents?.kind === "plaintext" ? `\`\`\`\n${contents.value}\n\`\`\`` : contents?.value ?? "";
}

export default class Code extends View {
  init(_props, cx) {
    this.cx = cx;
    this.sideWidth = SIDE_W;
    this.baseTexts = new Map();
    this.grep = { matches: [], index: -1, loading: false, message: "", caseSensitive: false, seq: 0 };
    this.grepInput = InputState.new({ placeholder: "Find in the project" });
    this.grepInput.on("change", () => this.queueGrep(GREP_DEBOUNCE));
    this.grepInput.on("submit", () => this.queueGrep(0));
    this.replaceInput = InputState.new({ placeholder: "Replace with" });
    this.replaceInput.on("submit", () => this.acceptMatch());
    this.peek = null;
    this.peekAt = null;
    cx.timer.every(200, () => this.updatePeek());
    this.resizing = null;
    this.references = null;
    this.handle = cx.focus_handle();
    this.root = null;
    this.files = [];
    this.lowered = [];
    this.search = { query: "", candidates: [], results: [] };
    this.tree = buildTree([]);
    this.expanded = new Set();
    this.documents = new Map();
    this.tabs = [];
    this.sidebarShown = true;
    this.mode = "files";
    this.changes = null;
    this.changedPaths = new Map();
    this.changesLoading = false;
    this.comments = [];
    this.review = null;
    this.publishing = false;
    this.composer = null;
    this.agentName = "the agent";
    this.commentInput = InputState.new({ placeholder: "Comment for the agent…" });
    this.commentInput.on("submit", () => this.addComment());
    this.treeScroll = ScrollHandle.new();
    this.tabScroll = ScrollHandle.new();
    this.servers = new Map();
    this.installs = new Map();
    this.serverStatus = {};
    this.current = null;
    this.back = [];
    this.forward = [];
    this.findOpen = false;
    this.findMatches = [];
    this.findIndex = -1;
    this.findInput = InputState.new({ placeholder: "Find in the file" });
    this.findInput.on("change", () => this.updateFind(true));
    this.findInput.on("submit", () => this.findStep(1));
    this.message = "";
    this.config = {};
    this.keymap = keymapOf({});
    this.shortcutsShown = false;
    this.finder = InputState.new({ placeholder: "Find a file" });
    this.finder.on("change", () => {
      this.refreshSearch();
      this.redraw();
    });
    this.finder.on("submit", () => {
      const [first] = this.search.results;
      if (first !== undefined) this.open(this.files[first], null);
    });
    cx.spawn(async (cx) => {
      try {
        this.config = JSON.parse((await readTextFile(`${MOD_DIR()}/config.json`)) ?? "{}");
        const width = Number(JSON.parse((await readTextFile(`${CACHE_DIR()}/layout.json`).catch(() => null)) ?? "{}").sideWidth);
        if (width >= SIDE_MIN && width <= SIDE_MAX) this.sideWidth = width;
      } catch {
        this.config = {};
      }
      this.keymap = keymapOf(this.config.keys ?? {});
      if (props()?.mode === "changes") this.mode = "changes";
      await this.loadRoot(props()?.root ?? focused()?.cwd ?? home());
      cx.spawn(async () => this.watchDisk());
      const agent = Array.isArray(this.config.agent) && this.config.agent.length ? this.config.agent : ["claude"];
      this.agentName = this.config.agentName ?? agentLabel(agent[0]);
      this.agent = new AgentSession(this.root, agent, (ms) => this.cx.sleep(ms));
      this.loadChanges();
      if (props()?.path) await this.open(props().path, props().line ? { line: props().line - 1, character: 0 } : null);
      else cx.timer.after(50, () => this.finder.focus());
      this.redraw();
    });
  }

  redraw() {
    this.cx.notify();
  }

  keyFor(id) {
    const overrides = this.config.keys ?? {};
    return Object.hasOwn(overrides, id) ? overrides[id] : ACTIONS.find((action) => action.id === id)?.key;
  }

  hint(id) {
    return keyLabel(this.keyFor(id));
  }

  startGrep() {
    this.sidebarShown = true;
    this.mode = "search";
    const document = this.current;
    if (document) {
      const { start, end } = document.state.selected_range();
      const selected = document.state.value().slice(Math.min(start, end), Math.max(start, end));
      if (selected && !selected.includes("\n")) this.grepInput.set_value(selected);
    }
    this.grepInput.focus();
    this.queueGrep(0);
  }

  queueGrep(delay) {
    const seq = ++this.grep.seq;
    this.grep.loading = Boolean(this.grepInput.value());
    this.redraw();
    this.cx.timer.after(delay, () => {
      if (seq === this.grep.seq) this.runGrep(seq);
    });
  }

  async runGrep(seq = ++this.grep.seq) {
    const query = this.grepInput.value();
    if (this.grep.running) {
      this.grep.pending = true;
      return;
    }
    if (!query || !this.root) {
      this.grep = { ...this.grep, matches: [], index: -1, loading: false, message: "" };
      this.redraw();
      return;
    }
    this.grep.loading = true;
    this.redraw();
    const args = ["-C", this.root, "grep", "-n", "-I", "--untracked", "--no-color", "--full-name", "-F", ...(this.grep.caseSensitive ? [] : ["-i"]), "-e", query, "--", "."];
    this.grep.running = true;
    const result = await exec("git", args, { timeout: 120000 }).catch((error) => ({ code: 2, stdout: "", stderr: String(error?.message ?? error) }));
    this.grep.running = false;
    if (this.grep.pending || seq !== this.grep.seq) {
      this.grep.pending = false;
      this.runGrep();
      return;
    }
    const matches = [];
    const needle = this.grep.caseSensitive ? query : query.toLowerCase();
    for (const raw of result.code === 0 ? result.stdout.split("\n") : []) {
      const parsed = /^(.*?):(\d+):(.*)$/.exec(raw);
      if (!parsed) continue;
      const [, path, number, text] = parsed;
      const haystack = this.grep.caseSensitive ? text : text.toLowerCase();
      for (let at = haystack.indexOf(needle); at >= 0 && matches.length < GREP_LIMIT; at = haystack.indexOf(needle, at + needle.length)) {
        matches.push({ path, line: Number(number) - 1, start: at, end: at + query.length, text });
      }
      if (matches.length >= GREP_LIMIT) break;
    }
    const message = result.code > 1 ? (result.stderr || "git grep failed").trim().split("\n").pop() : "";
    this.grep = { ...this.grep, matches, index: matches.length ? 0 : -1, loading: false, message, pending: false };
    this.redraw();
  }

  toggleGrepCase() {
    this.grep.caseSensitive = !this.grep.caseSensitive;
    this.queueGrep(0);
  }

  async showMatch(index) {
    const match = this.grep.matches[index];
    if (!match) return;
    this.grep.index = index;
    await this.open(match.path, null);
    const document = this.current;
    if (!document) return;
    this.cx.timer.after(30, () => {
      const offset = offsetOf(document.state.value(), { line: match.line, character: match.start });
      this.selectReal(document, { start: offset, end: offset + match.end - match.start });
      this.redraw();
    });
    this.redraw();
  }

  matchOffset(text, match) {
    const offset = offsetOf(text, { line: match.line, character: match.start });
    const found = text.slice(offset, offset + match.end - match.start);
    const query = this.grepInput.value();
    const same = this.grep.caseSensitive ? found === query : found.toLowerCase() === query.toLowerCase();
    return same ? offset : -1;
  }

  async acceptMatch() {
    const match = this.grep.matches[this.grep.index];
    if (!match) return;
    const replacement = this.replaceInput.value();
    const absolute = this.absolute(match.path);
    let document = this.documents.get(absolute);
    if (!document) {
      await this.open(match.path, null);
      document = this.documents.get(absolute);
    }
    if (!document) return;
    const offset = this.matchOffset(document.state.value(), match);
    if (offset < 0) {
      this.grep.message = `${match.path}:${match.line + 1} changed since the search, search again`;
      this.redraw();
      return;
    }
    const wasDirty = document.dirty;
    document.state.set_selected_range({ start: offset, end: offset + match.end - match.start });
    document.state.replace(replacement);
    if (!wasDirty) await this.saveDocument(document);
    this.dropMatch(this.grep.index, replacement.length - (match.end - match.start));
    this.showMatch(this.grep.index);
  }

  skipMatch() {
    if (this.grep.index < 0) return;
    this.grep.matches.splice(this.grep.index, 1);
    if (this.grep.index >= this.grep.matches.length) this.grep.index = this.grep.matches.length - 1;
    this.showMatch(this.grep.index);
    this.redraw();
  }

  dropMatch(index, delta) {
    const [done] = this.grep.matches.splice(index, 1);
    for (const match of this.grep.matches) {
      if (match.path === done.path && match.line === done.line && match.start > done.start) {
        match.start += delta;
        match.end += delta;
      }
    }
    if (this.grep.index >= this.grep.matches.length) this.grep.index = this.grep.matches.length - 1;
  }

  async replaceAll() {
    const replacement = this.replaceInput.value();
    const byPath = new Map();
    for (const match of this.grep.matches) byPath.set(match.path, [...(byPath.get(match.path) ?? []), match]);
    let replaced = 0;
    let stale = 0;
    for (const [path, matches] of byPath) {
      const absolute = this.absolute(path);
      const document = this.documents.get(absolute);
      const before = document ? document.state.value() : await readTextFile(absolute).catch(() => null);
      if (before === null) continue;
      let text = before;
      const ordered = [...matches].sort((a, b) => b.line - a.line || b.start - a.start);
      for (const match of ordered) {
        const offset = this.matchOffset(text, match);
        if (offset < 0) {
          stale++;
          continue;
        }
        text = text.slice(0, offset) + replacement + text.slice(offset + match.end - match.start);
        replaced++;
      }
      if (text === before) continue;
      if (document) {
        const wasDirty = document.dirty;
        document.state.set_selected_range({ start: 0, end: before.length });
        document.state.replace(text);
        if (!wasDirty) await this.saveDocument(document);
      } else {
        await writeTextFile(absolute, text, before);
      }
    }
    this.grep.matches = [];
    this.grep.index = -1;
    this.grep.message = `Replaced ${replaced} in ${byPath.size} file${byPath.size === 1 ? "" : "s"}${stale ? `, ${stale} skipped (changed since the search)` : ""}`;
    this.loadChanges();
    this.redraw();
  }

  grepView(t) {
    const { matches, index, loading, message, caseSensitive } = this.grep;
    const files = new Set(matches.map((match) => match.path)).size;
    const count = loading ? "Searching…" : this.grepInput.value() ? `${matches.length}${matches.length >= GREP_LIMIT ? "+" : ""} in ${files} file${files === 1 ? "" : "s"}` : "";
    const button = (id, label, run, enabled = true) => div().id(id).px(8).h(22).flex().items_center().rounded(5).text_size(11.5).border_1().border_color(t.border)
      .when(enabled, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click(run))
      .when(!enabled, (el) => el.text_color(t.dim))
      .on_mouse_down("left", stop).child(label);
    const rows = [];
    let last = null;
    matches.forEach((match, i) => {
      if (match.path !== last) {
        last = match.path;
        const inFile = matches.filter((other) => other.path === match.path).length;
        rows.push(h_flex().px(10).pt(6).pb(2).gap(6).items_center().min_w(0).text_size(11.5)
          .child(iconElement(fileIcon(match.path), t.dim))
          .child(div().min_w(0).truncate().child(basename(match.path)))
          .child(div().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(match.path.slice(0, -basename(match.path).length - 1)))
          .child(div().flex_1())
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(inFile))));
      }
      const lead = match.text.slice(0, match.start).replace(/^\s+/, "");
      rows.push(this.row(t, `grep-${i}`, 1, i === index)
        .on_click(() => this.showMatch(i))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(match.line + 1)))
        .child(h_flex().flex_1().min_w(0).overflow_hidden()
          .child(div().flex_none().text_color(t.dim).child(lead.length > 24 ? `…${lead.slice(-24)}` : lead))
          .child(div().flex_none().rounded(2).bg(FIND_COLOR).text_color(t.foreground).child(match.text.slice(match.start, match.end)))
          .child(div().min_w(0).truncate().text_color(t.dim).child(match.text.slice(match.end)))));
    });
    return v_flex().flex_1().min_h(0).min_w(0)
      .child(v_flex().flex_none().px(10).py(8).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().gap(6).items_center()
          .child(Input.new(this.grepInput).flex_1().h(28).text_size(12.5))
          .child(div().id("grep-case").flex_none().px(6).h(22).flex().items_center().rounded(5).text_size(11.5).cursor_pointer()
            .text_color(caseSensitive ? t.foreground : t.dim).when(caseSensitive, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover))
            .on_mouse_down("left", stop).on_click(() => this.toggleGrepCase()).child("Aa")))
        .child(Input.new(this.replaceInput).h(28).text_size(12.5))
        .child(h_flex().gap(6).items_center()
          .child(button("grep-accept", "Replace", () => this.acceptMatch(), index >= 0))
          .child(button("grep-skip", "Skip", () => this.skipMatch(), index >= 0))
          .child(button("grep-all", "Replace all", () => this.replaceAll(), matches.length > 0))
          .child(div().flex_1())
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(count)))
        .when(Boolean(message), (el) => el.child(div().text_size(11).text_color(t.dim).child(message))))
      .child(v_flex().id("grep-results").flex_1().min_h(0).pb(4).overflow_y_scrollbar().children(rows));
  }

  focusFinder() {
    this.sidebarShown = true;
    this.mode = "files";
    this.finder.focus();
    this.redraw();
  }

  toggleSidebar() {
    this.sidebarShown = !this.sidebarShown;
    this.redraw();
  }

  toggleChanges() {
    this.sidebarShown = true;
    this.mode = this.mode === "changes" ? "files" : "changes";
    this.redraw();
  }

  toggleShortcuts() {
    this.shortcutsShown = !this.shortcutsShown;
    this.redraw();
  }

  async watchDisk() {
    const root = this.root;
    for (;;) {
      const paths = await watchFolder(root).catch(() => []);
      if (root !== this.root) return;
      const relevant = paths.filter((path) => path === root || !/\/(\.git|node_modules)(\/|$)/.test(path.slice(root.length)) || /\/\.git\/(HEAD|index)$/.test(path));
      if (!paths.length) await this.cx.sleep(2000);
      if (!relevant.length) continue;
      await this.cx.sleep(300);
      await this.reloadFromDisk(relevant.includes(root) ? null : new Set(relevant));
      this.loadChanges();
      if (this.mode === "search" && this.grepInput.value() && !this.grep.running) this.queueGrep(0);
    }
  }

  async reloadFromDisk(paths) {
    for (const document of this.documents.values()) {
      if (paths && !paths.has(document.path)) continue;
      const text = await readTextFile(document.path).catch(() => null);
      if (text === null || text === document.saved) continue;
      if (document.dirty) {
        this.message = `${this.relative(document.path)} changed on disk; your unsaved edits are kept`;
        continue;
      }
      const { start, end } = document.state.selected_range();
      document.saved = text;
      document.state.set_value(text);
      document.dirty = false;
      document.state.set_selected_range({ start: Math.min(start, text.length), end: Math.min(end, text.length) });
    }
    this.redraw();
  }

  async loadChanges() {
    if (this.changesLoading) {
      this.changesAgain = true;
      return;
    }
    this.changesLoading = true;
    this.redraw();
    try {
      this.changes = await branchDiff(exec, this.root);
      this.changedPaths = new Map(this.changes.files.map((file) => [file.new_path, file.new_file ? "added" : "modified"]));
      this.review = await findReview(this.root, this.changes.branch).catch(() => null);
      for (const document of this.documents.values()) this.paintChanges(document);
    } catch (error) {
      this.message = `Changes: ${error?.message ?? error}`;
    }
    this.changesLoading = false;
    this.redraw();
    if (this.changesAgain) {
      this.changesAgain = false;
      this.loadChanges();
    }
  }

  updatePeek() {
    const document = this.current;
    const file = document && this.changedFile(document.path);
    if (!file) {
      if (this.peek) {
        this.peek = null;
        this.redraw();
      }
      this.peekAt = null;
      return;
    }
    const { start } = this.realRange(document);
    const at = `${document.path}:${start}:${file.rows.length}`;
    if (at === this.peekAt) return;
    this.peekAt = at;
    const line = positionOf(document.state.value(), start).line + 1;
    const peek = changeAt(file.rows, line);
    if (JSON.stringify(peek) === JSON.stringify(this.peek)) return;
    this.peek = peek;
    this.redraw();
  }

  peekPanel(t) {
    const { start, end, oldStart, old, added } = this.peek;
    const what = added ? `lines ${start}${end > start ? `–${end}` : ""} replaced ${old.length} line${old.length === 1 ? "" : "s"}` : `${old.length} line${old.length === 1 ? "" : "s"} deleted above line ${start}`;
    const width = String(oldStart + old.length).length;
    return v_flex().flex_none().max_h(180).border_b(1).border_color(t.border).bg(PEEK_BG)
      .child(div().px(12).pt(4).pb(2).text_size(11).text_color(t.dim).child(`Before · ${what}`))
      .child(v_flex().id("peek-lines").min_h(0).pb(4).overflow_y_scrollbar().font_family(MONO).text_size(12)
        .children(old.map((text, i) => h_flex().px(12).gap(10).min_w(0)
          .child(div().flex_none().text_color(t.dim).child(String(oldStart + i).padStart(width)))
          .child(div().flex_none().text_color(CHANGE_COLORS.deleted).child("−"))
          .child(div().min_w(0).truncate().text_color(t.foreground).child(text.replace(/\t/g, "  ") || " ")))));
  }

  changedFile(path) {
    const relative = this.relative(path);
    return this.changes?.files.find((file) => file.new_path === relative) ?? null;
  }

  paintChanges(document) {
    this.ensureBase(document);
    this.buildDiff(document);
  }

  async ensureBase(document) {
    const file = this.changedFile(document.path);
    const fork = this.changes?.fork;
    if (!file || !fork) return;
    const key = `${fork}:${file.old_path}`;
    if (document.baseKey === key) return;
    if (!this.baseTexts.has(key)) {
      const shown = file.new_file ? { code: 0, stdout: "" } : await exec("git", ["-C", this.root, "show", `${fork}:${file.old_path}`]);
      if (shown.code !== 0) return;
      this.baseTexts.set(key, shown.stdout);
    }
    document.baseKey = key;
    document.baseText = this.baseTexts.get(key);
    this.buildDiff(document);
    this.redraw();
  }

  diffRows(document, file) {
    if (document.baseText === undefined || document.baseKey !== `${this.changes?.fork}:${file.old_path}`) return file.rows;
    return lineDiff(document.baseText.split("\n"), document.state.value().split("\n"));
  }

  liveDiff(document) {
    const seq = (document.diffSeq ?? 0) + 1;
    document.diffSeq = seq;
    this.cx.timer.after(LIVE_DIFF_DELAY, () => {
      if (document.diffSeq === seq) this.buildDiff(document);
    });
  }

  buildDiff(document) {
    const file = this.changedFile(document.path);
    if (!file) {
      document.diff = null;
      return null;
    }
    const fileRows = this.diffRows(document, file);
    document.state.set_highlights("changes", changeHighlights(fileRows));
    const lines = document.state.value().split("\n");
    const deleted = new Map();
    const added = new Set();
    for (const row of fileRows) {
      if (row.kind === "del") deleted.set(row.newPos, [...(deleted.get(row.newPos) ?? []), row.text]);
      else if (row.kind === "add") added.add(row.new);
    }
    const out = [];
    const kinds = [];
    const pushDeleted = (at) => {
      for (const text of deleted.get(at) ?? []) {
        out.push(`${DELETED_MARK}${text}`);
        kinds.push("del");
      }
    };
    lines.forEach((text, i) => {
      pushDeleted(i + 1);
      out.push(text);
      kinds.push(added.has(i + 1) ? "add" : "ctx");
    });
    pushDeleted(lines.length + 1);
    const value = out.join("\n");
    if (!document.diff) {
      const state = EditorState.new({ language: document.language?.syntax ?? extensionOf(document.path), value, font_family: MONO, folding: false });
      document.diff = { state, value, deleted: out.filter((line) => line.startsWith(DELETED_MARK)) };
      state.on("change", () => this.syncFromDiff(document));
      this.applyDiffLsp(document);
    } else if (document.diff.state.value() !== value) {
      const range = this.realRange(document);
      document.diff.value = value;
      document.diff.deleted = out.filter((line) => line.startsWith(DELETED_MARK));
      document.diff.syncing = true;
      document.diff.state.set_value(value);
      document.diff.syncing = false;
      this.selectReal(document, range);
    }
    this.labelDiff(document);
    document.diff.state.set_highlights("diff", kinds.flatMap((kind, i) => (kind === "ctx" ? [] : [{
      range: { start: { line: i, character: 0 }, end: { line: i + 1, character: 0 } },
      color: kind === "del" ? DIFF_DELETED : DIFF_ADDED,
    }])));
    return document.diff;
  }

  syncFromDiff(document) {
    const diff = document.diff;
    if (diff.syncing) return;
    const lines = diff.state.value().split("\n");
    const deleted = lines.filter((line) => line.startsWith(DELETED_MARK));
    if (deleted.length !== diff.deleted.length || deleted.some((line, i) => line !== diff.deleted[i])) {
      if (diff.reverting) return;
      diff.reverting = true;
      this.cx.timer.after(0, () => {
        const at = Math.min(diff.state.selected_range().start, diff.value.length);
        const cursor = Math.max(0, diff.value.lastIndexOf("\n", Math.max(at - 1, 0)) + 1);
        diff.state.set_value(diff.value);
        diff.state.set_selected_range({ start: cursor, end: cursor });
        diff.reverting = false;
        this.message = "Deleted lines can't be edited";
        this.redraw();
      });
      return;
    }
    diff.value = lines.join("\n");
    const real = lines.filter((line) => !line.startsWith(DELETED_MARK)).join("\n");
    if (real !== document.state.value()) {
      document.syncing = true;
      document.state.set_value(real);
      document.syncing = false;
      this.liveDiff(document);
    }
    this.labelDiff(document);
  }

  labelDiff(document) {
    let line = 0;
    const lines = document.diff.state.value().split("\n");
    document.diff.state.set_line_labels(lines.map((text) => (text.startsWith(DELETED_MARK) ? "" : String(++line))));
    document.diff.state.set_locked_lines(lines.flatMap((text, i) => (text.startsWith(DELETED_MARK) ? [i] : [])));
  }

  applyDiffLsp(document) {
    if (!document.diff || !document.lspOptions) return;
    const real = (request) => ({ ...request, position: { line: this.realLineOf(document, request.position.line), character: request.position.character } });
    const toDiff = (range) => range && {
      start: { ...range.start, line: this.diffLineOf(document, range.start.line) },
      end: { ...range.end, line: this.diffLineOf(document, range.end.line) },
    };
    const back = {
      hover: (answer) => (answer?.range ? { ...answer, range: toDiff(answer.range) } : answer),
      definition: (answer) => (Array.isArray(answer)
        ? answer.map((link) => (link?.originSelectionRange ? { ...link, originSelectionRange: toDiff(link.originSelectionRange) } : link))
        : answer),
    };
    const options = { ...document.lspOptions };
    for (const kind of ["completion", "hover", "definition"]) {
      const handler = document.lspOptions[kind];
      const map = back[kind] ?? ((answer) => answer);
      if (handler) options[kind] = async (request, cx) => map(await handler(real(request), cx));
    }
    try {
      document.diff.state.lsp({ ...options, hover_trigger: "selection" });
    } catch {
      document.diff.state.lsp(options);
    }
  }

  diffVisible(document) {
    return Boolean(document?.diff);
  }

  activeState(document) {
    return this.diffVisible(document) ? document.diff.state : document.state;
  }

  focusActive(document) {
    if (document) this.activeState(document).focus();
  }

  realRange(document) {
    if (!this.diffVisible(document)) return document.state.selected_range();
    const diffText = document.diff.state.value();
    const text = document.state.value();
    const map = (offset) => {
      const { line, character } = positionOf(diffText, offset);
      return offsetOf(text, { line: this.realLineOf(document, line), character });
    };
    const { start, end } = document.diff.state.selected_range();
    return { start: map(start), end: map(end) };
  }

  selectReal(document, range) {
    if (!this.diffVisible(document)) {
      document.state.set_selected_range(range);
      return;
    }
    const text = document.state.value();
    const diffText = document.diff.state.value();
    const map = (offset) => {
      const { line, character } = positionOf(text, offset);
      return offsetOf(diffText, { line: this.diffLineOf(document, line), character });
    };
    document.diff.state.set_selected_range({ start: map(range.start), end: map(range.end) });
  }

  diffLineOf(document, line) {
    const lines = document.diff.state.value().split("\n");
    let real = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(DELETED_MARK)) continue;
      if (real === line) return i;
      real++;
    }
    return Math.max(lines.length - 1, 0);
  }

  realLineOf(document, diffLine) {
    return document.diff.state.value().split("\n").slice(0, diffLine).filter((line) => !line.startsWith(DELETED_MARK)).length;
  }





  paintComments(document) {
    const relative = this.relative(document.path);
    document.state.set_highlights("comments", this.comments
      .filter((comment) => comment.path === relative)
      .map((comment) => ({ range: lineRange(comment.start, comment.end), color: COMMENT_COLOR, style: "frame" })));
  }

  startComment() {
    const document = this.current;
    if (!document) return;
    const text = document.state.value();
    const range = this.realRange(document);
    const start = positionOf(text, range.start).line + 1;
    let end = positionOf(text, range.end).line + 1;
    if (range.end > range.start && text[range.end - 1] === "\n" && end > start) end -= 1;
    this.composer = { path: this.relative(document.path), start, end, code: text.split("\n").slice(start - 1, end).join("\n") };
    this.commentInput.set_value("");
    this.commentInput.focus();
    this.redraw();
  }

  cancelComment() {
    this.composer = null;
    this.focusActive(this.current);
    this.redraw();
  }

  addComment() {
    const note = this.commentInput.value().trim();
    if (!this.composer || !note) return;
    this.comments.push({ id: `${Date.now()}-${this.comments.length}`, ...this.composer, note });
    this.composer = null;
    for (const document of this.documents.values()) this.paintComments(document);
    this.focusActive(this.current);
    this.message = `${this.comments.length} comment${this.comments.length > 1 ? "s" : ""} ready · ${this.hint("send")} sends the review to ${this.agentName}`;
    this.redraw();
  }

  removeComment(id) {
    this.comments = this.comments.filter((comment) => comment.id !== id);
    for (const document of this.documents.values()) this.paintComments(document);
    this.redraw();
  }

  async publish() {
    const review = this.review;
    if (!review) {
      this.message = "No open MR/PR for this branch (or glab/gh isn't logged in)";
      this.redraw();
      return;
    }
    if (!this.comments.length) {
      this.message = `No comment yet: select lines, then ${this.hint("comment")}`;
      this.redraw();
      return;
    }
    if (this.publishing) return;
    const head = (await exec("git", ["-C", this.root, "rev-parse", "HEAD"])).stdout.trim();
    const paths = [...new Set(this.comments.map((comment) => comment.path))];
    if (head !== review.head) {
      const unchanged = (await exec("git", ["-C", this.root, "diff", "--quiet", head, review.head, "--", ...paths])).code === 0;
      if (!unchanged) {
        this.message = `${review.label} ${review.name} (${String(review.head).slice(0, 7)}) differs from your checkout (${head.slice(0, 7)}) on the commented files: update it (git pull, or push yours), then check your comments`;
        this.redraw();
        return;
      }
    }
    const changed = [];
    for (const path of paths) {
      if ((await exec("git", ["-C", this.root, "diff", "--quiet", "HEAD", "--", path])).code !== 0) changed.push(path);
    }
    if (changed.length) {
      this.message = `Commit and push first, changed since the last push: ${changed.join(", ")}`;
      this.redraw();
      return;
    }
    const sent = this.comments;
    this.publishing = true;
    this.message = `Publishing on ${review.label} ${review.name}…`;
    this.redraw();
    try {
      const { inline, general } = await publishReview(this.root, review, sent, this.changes?.files ?? []);
      this.comments = this.comments.filter((comment) => !sent.includes(comment));
      for (const document of this.documents.values()) this.paintComments(document);
      this.message = `Published on ${review.label} ${review.name}: ${inline} on their lines${general ? `, ${general} in the review's comment (outside the diff)` : ""}`;
    } catch (error) {
      this.message = `Not published: ${error?.message ?? error}`;
    }
    this.publishing = false;
    this.redraw();
  }

  async sendReview() {
    if (!this.comments.length) {
      this.message = `No comment yet: select lines, then ${this.hint("comment")}`;
      this.redraw();
      return;
    }
    const sent = this.comments;
    const here = focused()?.pane ?? null;
    this.message = `Sending the review to ${this.agentName}…`;
    this.redraw();
    try {
      const shown = await this.agent.send(reviewPrompt({ branch: this.changes?.branch ?? "HEAD", base: this.changes?.base }, sent));
      if (here) run("pane.focus", { pane: here });
      this.comments = this.comments.filter((comment) => !sent.includes(comment));
      for (const document of this.documents.values()) this.paintComments(document);
      const count = `${sent.length} comment${sent.length > 1 ? "s" : ""}`;
      this.message = shown ? `Sent ${count}: ${this.agentName} answers on the right` : `Sent ${count}: ${this.agentName} is starting in the background`;
    } catch (error) {
      this.message = `Couldn't reach ${this.agentName}: ${error?.message ?? error}`;
    }
    this.redraw();
  }

  async loadRoot(folder) {
    const top = await exec("git", ["-C", folder, "rev-parse", "--show-toplevel"]);
    this.root = top.code === 0 ? top.stdout.trim() : folder;
    const listed = await exec("git", ["-C", this.root, "ls-files", "--cached", "--others", "--exclude-standard"]);
    this.files = listed.code === 0 ? listed.stdout.split("\n").filter(Boolean) : [];
    this.lowered = this.files.map((path) => path.toLowerCase());
    this.tree = buildTree(this.files);
    this.search = { query: "", candidates: [], results: [] };
    this.refreshSearch();
  }

  refreshSearch() {
    const query = this.finder.value().trim().toLowerCase();
    const previous = this.search;
    if (!query) {
      this.search = { query, candidates: [], results: [] };
      return;
    }
    const pool = previous.query && query.startsWith(previous.query) ? previous.candidates : this.lowered.keys();
    const scored = [];
    for (const index of pool) {
      const score = fuzzyScore(this.lowered[index], query);
      if (score !== null) scored.push({ index, score });
    }
    scored.sort((a, b) => a.score - b.score);
    this.search = {
      query,
      candidates: scored.map(({ index }) => index),
      results: scored.slice(0, SHOWN_FILES).map(({ index }) => index),
    };
  }

  treeRows(node = this.tree, depth = 0, rows = []) {
    for (const folder of node.folders) {
      const open = this.expanded.has(folder.path);
      rows.push({ kind: "folder", name: folder.name, path: folder.path, depth, open });
      if (open) this.treeRows(folder, depth + 1, rows);
    }
    for (const file of node.files) rows.push({ kind: "file", name: file.name, path: file.path, depth });
    return rows;
  }

  toggle(folder) {
    if (this.expanded.has(folder)) this.expanded.delete(folder);
    else this.expanded.add(folder);
    this.redraw();
  }

  absolute(path) {
    return path.startsWith("/") ? path : `${this.root}/${path}`;
  }

  relative(path) {
    return path.startsWith(`${this.root}/`) ? path.slice(this.root.length + 1) : path;
  }

  async open(path, selection) {
    const absolute = this.absolute(path);
    let document = this.documents.get(absolute);
    if (!document) {
      const text = await readTextFile(absolute).catch(() => null);
      if (text === null) {
        this.message = `Cannot read ${this.relative(absolute)}`;
        this.redraw();
        return;
      }
      document = this.documents.get(absolute) ?? this.createDocument(absolute, text);
      this.documents.set(absolute, document);
    }
    if (!this.tabs.includes(absolute)) {
      const after = this.current ? this.tabs.indexOf(this.current.path) + 1 : this.tabs.length;
      this.tabs.splice(after, 0, absolute);
    }
    if (this.current && this.current !== document) {
      this.back.push(this.location(this.current));
      this.forward = [];
      this.clearFind(this.current);
    }
    this.current = document;
    if (this.findOpen) this.updateFind(false);
    this.message = "";
    this.reveal(document);
    if (selection) {
      const text = document.state.value();
      const start = offsetOf(text, selection.start ?? selection);
      const end = selection.end ? offsetOf(text, selection.end) : start;
      this.selectReal(document, { start, end });
    }
    this.focusActive(document);
    this.redraw();
  }

  reveal(document) {
    const relative = this.relative(document.path);
    for (const folder of ancestorsOf(relative)) this.expanded.add(folder);
    if (!this.search.query) {
      const row = this.treeRows().findIndex((entry) => entry.path === relative);
      if (row >= 0) this.treeScroll.scroll_to_item(row);
    }
    const tab = this.tabs.indexOf(document.path);
    if (tab >= 0) this.tabScroll.scroll_to_item(tab);
  }

  closeTab(path) {
    const document = this.documents.get(path);
    if (!document) return;
    if (document.dirty && !document.closeArmed) {
      document.closeArmed = true;
      this.message = `${basename(path)} has unsaved changes: ${this.hint("save")} to save, ${this.hint("close")} again to close`;
      this.redraw();
      return;
    }
    const index = this.tabs.indexOf(path);
    this.tabs.splice(index, 1);
    this.back = this.back.filter((entry) => entry.path !== path);
    this.forward = this.forward.filter((entry) => entry.path !== path);
    this.documents.delete(path);
    this.notifyServers(document, "textDocument/didClose", { textDocument: { uri: document.uri } });
    if (this.current === document) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.current = next ? this.documents.get(next) : null;
      if (this.current) {
        this.reveal(this.current);
        this.focusActive(this.current);
      }
    }
    document.state.release();
    this.message = "";
    this.redraw();
  }

  cycleTab(step) {
    if (!this.current || this.tabs.length < 2) return;
    const index = this.tabs.indexOf(this.current.path);
    this.open(this.tabs[(index + step + this.tabs.length) % this.tabs.length], null);
  }

  async goToDefinition() {
    const document = this.current;
    const servers = ((await document?.servers) ?? []).filter((server) => server.capabilities.definitionProvider);
    if (!servers.length) {
      this.message = "No language server gives definitions for this file";
      this.redraw();
      return;
    }
    const position = positionOf(document.state.value(), this.realRange(document).start);
    let target = null;
    for (const server of servers) {
      const answer = await server.client
        .request("textDocument/definition", { textDocument: { uri: document.uri }, position })
        .catch(() => null);
      [target] = [answer ?? []].flat();
      if (target) break;
    }
    const uri = target?.targetUri ?? target?.uri;
    if (!uri) {
      this.message = "No definition found";
      this.redraw();
      return;
    }
    if (!String(uri).startsWith("file://")) {
      this.message = `The definition is in ${uri}`;
      this.redraw();
      return;
    }
    await this.open(uriPath(uri), target.targetSelectionRange ?? target.range);
  }

  location(document) {
    return { path: document.path, range: this.realRange(document) };
  }

  goBack() {
    this.travel(this.back, this.forward);
  }

  goForward() {
    this.travel(this.forward, this.back);
  }

  travel(from, to) {
    const target = from.pop();
    if (!target) return;
    const document = this.documents.get(target.path);
    if (!document) return;
    if (this.current) {
      to.push(this.location(this.current));
      this.clearFind(this.current);
    }
    this.current = document;
    if (this.findOpen) this.updateFind(false);
    this.reveal(document);
    this.selectReal(document, target.range);
    this.focusActive(document);
    this.redraw();
  }

  clearFind(document) {
    document?.state.set_highlights("find", []);
    document?.diff?.state.set_highlights("find", []);
  }

  startFind() {
    const document = this.current;
    if (!document) return;
    const { start, end } = this.activeState(document).selected_range();
    const selected = this.activeState(document).value().slice(Math.min(start, end), Math.max(start, end));
    this.findOpen = true;
    if (selected && !selected.includes("\n")) this.findInput.set_value(selected);
    this.findInput.focus();
    this.updateFind(true);
  }

  updateFind(jump) {
    const document = this.current;
    if (!document) return;
    const text = this.activeState(document).value();
    const query = this.findInput.value().toLowerCase();
    const haystack = text.toLowerCase();
    const matches = [];
    for (let at = query ? haystack.indexOf(query) : -1; at >= 0 && matches.length < FIND_LIMIT; at = haystack.indexOf(query, at + query.length)) {
      matches.push({ start: at, end: at + query.length });
    }
    this.findMatches = matches;
    if (jump || this.findIndex >= matches.length) {
      const { start, end } = this.activeState(document).selected_range();
      const next = matches.findIndex((match) => match.start >= Math.min(start, end));
      this.findIndex = matches.length ? Math.max(next, 0) : -1;
    }
    this.showFind(text, jump);
  }

  findStep(step) {
    if (!this.findOpen) return this.startFind();
    if (!this.findMatches.length) return;
    this.findIndex = (this.findIndex + step + this.findMatches.length) % this.findMatches.length;
    this.showFind(this.activeState(this.current).value(), true);
  }

  showFind(text, select) {
    const document = this.current;
    const positions = positionsOf(text, this.findMatches.flatMap((match) => [match.start, match.end]));
    this.activeState(document).set_highlights("find", this.findMatches.map((_, i) => ({
      range: { start: positions[2 * i], end: positions[2 * i + 1] },
      color: i === this.findIndex ? FIND_CURRENT_COLOR : FIND_COLOR,
      style: i === this.findIndex ? "frame" : "fill",
    })));
    const current = this.findMatches[this.findIndex];
    if (select && current) this.activeState(document).set_selected_range(current);
    this.redraw();
  }

  closeFind() {
    this.findOpen = false;
    this.findMatches = [];
    this.findIndex = -1;
    this.clearFind(this.current);
    this.focusActive(this.current);
    this.redraw();
  }

  findBar(t) {
    const count = this.findMatches.length;
    const label = !this.findInput.value() ? "" : count ? `${this.findIndex + 1}/${count}${count >= FIND_LIMIT ? "+" : ""}` : "No match";
    return h_flex().flex_none().px(12).py(6).gap(8).items_center().border_b(1).border_color(t.border)
      .child(Input.new(this.findInput).flex_1().h(28).text_size(12.5))
      .child(div().flex_none().w(64).font_family(MONO).text_size(11).text_color(count ? t.foreground : t.dim).child(label))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("⏎ next · ⇧⏎ previous · Esc close"));
  }

  startResize(e, cx) {
    this.resizing = { x: e.position.x, width: this.sideWidth };
    cx.stop_propagation();
  }

  resize(e) {
    if (!this.resizing) return;
    const width = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, this.resizing.width + e.position.x - this.resizing.x)));
    if (width === this.sideWidth) return;
    this.sideWidth = width;
    this.redraw();
  }

  endResize() {
    if (!this.resizing) return;
    this.resizing = null;
    this.cx.spawn(async () => {
      await exec("mkdir", ["-p", CACHE_DIR()]);
      await writeTextFile(`${CACHE_DIR()}/layout.json`, JSON.stringify({ sideWidth: this.sideWidth }));
    });
  }

  async findReferences() {
    const document = this.current;
    if (!document) return;
    const servers = ((await document.servers) ?? []).filter((server) => server.capabilities.referencesProvider);
    if (!servers.length) {
      this.message = "No language server finds references for this file";
      this.redraw();
      return;
    }
    const text = document.state.value();
    const offset = this.realRange(document).start;
    const position = positionOf(text, offset);
    const name = wordAt(text, offset);
    this.references = { name, items: [], loading: true };
    this.redraw();
    const answers = await Promise.all(servers.map((server) => server.client
      .request("textDocument/references", { textDocument: { uri: document.uri }, position, context: { includeDeclaration: true } })
      .catch(() => null)));
    const seen = new Set();
    const locations = answers.flatMap((answer) => (Array.isArray(answer) ? answer : []))
      .filter((location) => String(location?.uri).startsWith("file://"))
      .filter((location) => {
        const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}`;
        return !seen.has(key) && seen.add(key);
      })
      .slice(0, REFERENCES_LIMIT);
    const texts = new Map();
    const items = [];
    for (const location of locations) {
      const path = uriPath(location.uri);
      if (!texts.has(path)) texts.set(path, this.documents.get(path)?.state.value() ?? (await readTextFile(path).catch(() => null)) ?? "");
      const line = texts.get(path).split("\n")[location.range.start.line] ?? "";
      items.push({ path, line: location.range.start.line, character: location.range.start.character, end: location.range.end, text: line.trim() });
    }
    items.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    if (this.references?.name !== name) return;
    this.references = { name, items, loading: false };
    this.redraw();
  }

  async goToReference(item) {
    await this.open(item.path, null);
    const document = this.current;
    if (!document || document.path !== item.path) return;
    this.clearReferenceMark();
    const start = { line: item.line, character: item.character };
    document.state.set_highlights("reference", [{ range: { start: { line: item.line, character: 0 }, end: { line: item.line + 1, character: 0 } }, color: REFERENCE_COLOR }]);
    this.referenceMark = document;
    this.references.selected = item;
    this.cx.timer.after(30, () => {
      const text = document.state.value();
      this.selectReal(document, { start: offsetOf(text, start), end: offsetOf(text, item.end ?? start) });
      this.focusActive(document);
      this.redraw();
    });
    this.redraw();
  }

  clearReferenceMark() {
    this.referenceMark?.state.set_highlights("reference", []);
    this.referenceMark = null;
  }

  closeReferences() {
    this.clearReferenceMark();
    this.references = null;
    this.focusActive(this.current);
    this.redraw();
  }

  referencesPanel(t) {
    const { name, items, loading } = this.references;
    const files = new Set(items.map((item) => item.path)).size;
    const title = loading ? `Looking for ${name || "the symbol"}…` : `${name || "Symbol"} · ${items.length} use${items.length === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}`;
    return v_flex().h(220).flex_none().min_w(0).border_t(1).border_color(t.border)
      .child(h_flex().h(28).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(title))
        .child(div().id("references-close").flex_none().px(6).rounded(4).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", stop).on_click(() => this.closeReferences()).child("Esc ✕")))
      .child(v_flex().id("references-list").flex_1().min_h(0).py(4).overflow_y_scrollbar()
        .when(!loading && !items.length, (el) => el.child(div().px(12).py(6).text_size(12).text_color(t.dim).child("No use found")))
        .children(items.map((item, index) => this.row(t, `reference-${index}`, 0, item === this.references.selected)
          .on_click(() => this.goToReference(item))
          .child(div().flex_none().text_color(t.dim).child(`${this.relative(item.path)}:${item.line + 1}`))
          .child(div().flex_1().min_w(0).truncate().child(item.text)))));
  }

  createDocument(path, text) {
    const extension = extensionOf(path);
    const language = LANGUAGES[extension] ?? (shebangOf(text) ? SHELL : null);
    const state = EditorState.new({ language: language?.syntax ?? extension, value: text, font_family: MONO });
    const document = { path, uri: fileUri(path), state, saved: text, dirty: false, version: 1, diagnostics: [], diagnosticsBy: new Map(), language };
    state.on("change", () => {
      if (document.diff && !document.syncing) this.liveDiff(document);
      document.version += 1;
      document.dirty = state.value() !== document.saved;
      document.closeArmed = false;
      this.notifyServers(document, "textDocument/didChange", {
        textDocument: { uri: document.uri, version: document.version },
        contentChanges: [{ text: state.value() }],
      });
      this.redraw();
    });
    document.servers = language ? this.attach(document) : Promise.resolve([]);
    this.paintChanges(document);
    this.paintComments(document);
    return document;
  }

  notifyServers(document, method, params) {
    document.servers.then((servers) => servers.forEach((server) => server.client.notify(method, params)));
  }

  async attach(document) {
    const started = await Promise.all(document.language.servers.map((name) => this.server(name)));
    if (this.documents.get(document.path) !== document) return [];
    const servers = started.filter(Boolean);
    for (const server of servers) {
      server.client.notify("textDocument/didOpen", {
        textDocument: { uri: document.uri, languageId: document.language.id, version: document.version, text: document.state.value() },
      });
    }
    const at = (request) => ({ textDocument: { uri: document.uri }, position: request.position });
    const able = (capability) => servers.filter((server) => server.capabilities[capability]);
    const firstAnswer = (capability, method) => able(capability).length
      ? async (request) => {
        for (const server of able(capability)) {
          const answer = await server.client.request(method, at(request)).catch(() => null);
          if (answer && (!Array.isArray(answer) || answer.length)) return answer;
        }
        return null;
      }
      : undefined;
    const completers = able("completionProvider");
    const options = {
      uri: document.uri,
      trigger_characters: [...new Set(completers.flatMap((server) => server.capabilities.completionProvider.triggerCharacters ?? []))],
      completion: completers.length
        ? async (request) => {
          const answers = await Promise.all(completers.map((server) => server.client
            .request("textDocument/completion", { ...at(request), context: contextFor(request.context, server) })
            .catch(() => null)));
          return { isIncomplete: answers.some((answer) => answer?.isIncomplete), items: answers.flatMap(completionItems) };
        }
        : undefined,
      hover: able("hoverProvider").length ? (request) => this.hoverWithValue(document, firstAnswer("hoverProvider", "textDocument/hover"), firstAnswer("definitionProvider", "textDocument/definition"), request) : undefined,
      definition: firstAnswer("definitionProvider", "textDocument/definition"),
      show_document: (params) => this.open(uriPath(params.uri), params.selection),
    };
    document.lspOptions = options;
    this.applyDiffLsp(document);
    try {
      document.state.lsp({ ...options, hover_trigger: "selection" });
    } catch {
      document.state.lsp(options);
    }
    return servers;
  }

  async hoverWithValue(document, hover, definition, request) {
    const [answer, target] = await Promise.all([hover(request), definition ? definition(request).catch(() => null) : null]);
    const value = await this.assignedValue(document, target);
    if (!answer || !value) return answer;
    return { ...answer, contents: { kind: "markdown", value: `${hoverText(answer.contents)}\n\n\`\`\`\n${value}\n\`\`\`` } };
  }

  async assignedValue(document, target) {
    const link = Array.isArray(target) ? target[0] : target;
    const uri = link?.targetUri ?? link?.uri;
    const range = link?.targetRange ?? link?.range;
    if (!uri || !range || range.start.line !== range.end.line) return null;
    const path = uriPath(uri);
    const text = path === document.path ? document.state.value() : this.documents.get(path)?.state.value() ?? await readTextFile(path).catch(() => null);
    const line = text?.split("\n")[range.start.line];
    const match = line?.match(/^\s*[A-Za-z_]\w*\s*(?::[^=]+)?=\s*(.+?)\s*$/);
    return match && !match[1].startsWith("=") ? line.trim() : null;
  }

  server(name) {
    if (!this.servers.has(name)) this.servers.set(name, this.startServer(name));
    return this.servers.get(name);
  }

  async findVenv() {
    for (const folder of [".venv", "venv"]) {
      const venv = `${this.root}/${folder}`;
      if ((await exec("test", ["-x", `${venv}/bin/python`])).code === 0) return venv;
    }
    return null;
  }

  workspaceOf(spec) {
    if (!spec.workspace) return this.root;
    const manifests = this.files.filter((path) => basename(path) === spec.workspace).sort((a, b) => a.length - b.length);
    return manifests.length ? this.absolute(manifests[0].slice(0, -spec.workspace.length - 1) || ".") : this.root;
  }

  async installed(kind, binary, cwd) {
    const probe = kind === "rustup" ? exec(binary, ["--version"], { cwd }) : exec("test", ["-x", binary]);
    return (await probe.catch(() => ({ code: 1 }))).code === 0;
  }

  async install(name, kind, binary, cwd) {
    if (await this.installed(kind, binary, cwd)) return;
    this.setStatus(name, "installing");
    if (!this.installs.has(kind)) this.installs.set(kind, this.runInstall(kind, cwd));
    await this.installs.get(kind);
  }

  async runInstall(kind, cwd) {
    await exec("mkdir", ["-p", SERVERS_DIR()]);
    const timeout = 600000;
    const result = kind === "npm"
      ? await exec("npm", ["install", "--prefix", SERVERS_DIR(), "--no-fund", "--no-audit", ...NPM_SERVERS], { timeout })
      : kind === "rustup"
        ? await exec("rustup", ["component", "add", "rust-analyzer", "rust-src"], { cwd, timeout })
        : await exec("sh", ["-c", INSTALL_TOFU_LS, "sh", SERVERS_DIR(), TOFU_LS_VERSION], { timeout });
    if (result.code !== 0) throw new Error(`install failed: ${(result.stderr || result.stdout).trim().split("\n").pop()}`);
  }

  async relayToTypescript(client) {
    const typescript = await this.server("typescript");
    client.on("tsserver/request", async (requests) => {
      for (const [id, command, args] of requests ?? []) {
        const answer = await typescript?.client
          .request("workspace/executeCommand", { command: "typescript.tsserverRequest", arguments: [command, args, { isAsync: true, lowPriority: true }] })
          .catch(() => null);
        client.notify("tsserver/response", [[id, answer?.body]]);
      }
    });
  }

  showDiagnostics(name, uri, diagnostics) {
    const document = this.documents.get(uriPath(uri));
    if (!document) return;
    document.diagnosticsBy.set(name, diagnostics);
    document.diagnostics = [...document.diagnosticsBy.values()].flat();
    document.state.set_diagnostics(document.diagnostics);
    this.redraw();
  }

  async startServer(name) {
    const spec = SERVERS[name];
    const configured = this.config.servers?.[name];
    let command = configured ?? spec.command();
    const cwd = this.workspaceOf(spec);
    try {
      if (!configured && spec.install) await this.install(name, spec.install, command[0], cwd);
      const venv = name === "python" ? await this.findVenv() : null;
      if (venv) command = ["env", `VIRTUAL_ENV=${venv}`, ...command];
      this.setStatus(name, "starting");
      const client = await launch({
        bridge: `${MOD_DIR()}/lsp-bridge.mjs`,
        cacheDir: `${CACHE_DIR()}/ports`,
        root: cwd,
        command,
        sleep: (ms) => this.cx.sleep(ms),
      });
      client.on("textDocument/publishDiagnostics", ({ uri, diagnostics }) => this.showDiagnostics(name, uri, diagnostics));
      client.on("$/closed", () => this.setStatus(name, "stopped"));
      if (name === "vue") await this.relayToTypescript(client);
      const settings = name === "typescript"
        ? typescriptSettings()
        : name === "rust"
          ? { "rust-analyzer": { linkedProjects: [`${cwd}/Cargo.toml`] } }
          : venv ? { python: { pythonPath: `${venv}/bin/python` } } : {};
      const initializationOptions = name === "rust" ? settings["rust-analyzer"] : settings;
      const capabilities = await client.initialize(this.root, (section) => lookup(settings, section), initializationOptions);
      client.notify("workspace/didChangeConfiguration", { settings });
      this.setStatus(name, "ready");
      return { name, client, capabilities };
    } catch (error) {
      this.setStatus(name, `error: ${error?.message ?? error}`);
      return null;
    }
  }

  setStatus(name, status) {
    this.serverStatus[name] = status;
    this.cx.notify();
  }

  async save() {
    await this.saveDocument(this.current);
    this.redraw();
  }

  async saveDocument(document) {
    if (!document) return;
    const text = document.state.value();
    if (text === document.saved) return;
    try {
      await writeTextFile(document.path, text, document.saved);
      document.saved = text;
      document.dirty = false;
      this.notifyServers(document, "textDocument/didSave", { textDocument: { uri: document.uri }, text });
      this.message = `Saved ${this.relative(document.path)}`;
      this.loadChanges();
    } catch (error) {
      this.message = `Not saved: ${error?.message ?? error}`;
    }
    this.redraw();
  }

  onKey(e, cx) {
    const key = e.keystroke;
    const action = this.keymap.get(key);
    if (action) action.run(this);
    else if (key === "shift-enter" && this.findOpen) this.findStep(-1);
    else if (key === "escape" && this.references) this.closeReferences();
    else if (key === "escape" && this.findOpen) this.closeFind();
    else if (key === "escape" && this.shortcutsShown) this.toggleShortcuts();
    else if (key === "escape" && this.composer) this.cancelComment();
    else if (key === "escape" && this.current) this.focusActive(this.current);
    else if (key === "escape" && props()?.overlay) closeOverlay(props().overlay);
    else return;
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    return v_flex().id("code-root").relative().size_full().min_h(0).bg(t.background).text_size(13).text_color(t.foreground)
      .track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_move((e) => this.resize(e))
      .on_mouse_up("left", () => this.endResize())
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .when(this.sidebarShown, (el) => el.child(this.sidebar(t)))
        .child(this.editorPane(t)))
      .child(this.footer(t))
      .when(this.shortcutsShown, (el) => el.child(this.shortcutsModal(t)));
  }

  shortcutsModal(t) {
    const rows = [...ACTIONS.map((action) => [this.keyFor(action.id), action.label]), ...FIXED_SHORTCUTS];
    return div().id("shortcuts-backdrop").absolute().inset_0().flex().items_center().justify_center().bg("#0000002e")
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.toggleShortcuts();
      })
      .child(v_flex().id("shortcuts").w(400).p(14).gap(2).rounded(10).border_1().border_color(t.border).bg(t.popover)
        .on_mouse_down("left", stop)
        .child(h_flex().pb(8).items_center()
          .child(div().flex_1().text_size(13).font_semibold().child("Shortcuts"))
          .child(div().text_size(11).text_color(t.dim).child("change them in config.json → keys")))
        .children(rows.map(([key, label], index) => h_flex().id(`shortcut-${index}`).h(26).gap(12).items_center()
          .child(div().flex_1().text_size(12.5).child(label))
          .child(div().px(6).py(1).rounded(4).bg(t.selected).font_family(MONO).text_size(11.5).child(keyLabel(key))))));
  }

  sidebar(t) {
    const currentPath = this.current ? this.relative(this.current.path) : null;
    const changed = this.changes?.files.length ?? 0;
    const head = h_flex().h(32).flex_none().px(6).gap(2).items_center().border_b(1).border_color(t.border)
      .child(this.modeButton(t, "files", "Files"))
      .child(this.modeButton(t, "changes", changed ? `Changes ${changed}` : "Changes"))
      .child(this.modeButton(t, "search", "Search"))
      .child(div().flex_1())
      .when(this.mode === "changes", (el) => el.child(div().id("changes-refresh").px(6).rounded(4).text_size(12).text_color(t.dim)
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click(() => this.loadChanges())
        .child(this.changesLoading ? "…" : "↻")));
    const side = v_flex().relative().w(this.sideWidth).flex_none().min_h(0).min_w(0).overflow_hidden().border_r(1).border_color(t.border)
      .child(div().id("side-resize").absolute().top(0).bottom(0).right(0).w(5).cursor_col_resize().hover((s) => s.bg(t.accent))
        .when(Boolean(this.resizing), (el) => el.bg(t.accent))
        .on_mouse_down("left", (e, cx) => this.startResize(e, cx)))
      .child(head);
    if (this.mode === "changes") return side.child(this.changesView(t, currentPath)).child(this.reviewPanel(t));
    if (this.mode === "search") return side.child(this.grepView(t));
    return side
      .child(h_flex().h(40).flex_none().px(10).items_center().border_b(1).border_color(t.border)
        .child(Input.new(this.finder).flex_1().h(28).text_size(12.5)))
      .child(v_flex().id("code-files").flex_1().min_h(0).py(4).overflow_y_scrollbar().track_scroll(this.treeScroll)
        .children(this.search.query ? this.searchRows(t, currentPath) : this.treeView(t, currentPath)))
      .child(this.reviewPanel(t));
  }

  reviewPanel(t) {
    const count = this.comments.length;
    const items = this.comments.map((comment) => v_flex().id(`comment-${comment.id}`).mx(4).px(8).py(4).gap(2).rounded(5).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", stop)
      .on_click(() => this.open(comment.path, { start: { line: comment.start - 1, character: 0 }, end: { line: comment.end - 1, character: 0 } }))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(11).text_color(COMMENT_COLOR).child(where(comment)))
        .child(div().id(`remove-${comment.id}`).px(4).rounded(4).text_size(11).text_color(t.dim).hover((s) => s.bg(t.selected))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.removeComment(comment.id);
          })
          .child("×")))
      .child(div().text_size(12).child(comment.note)));
    return v_flex().flex_none().border_t(1).border_color(t.border)
      .child(h_flex().h(30).flex_none().px(12).gap(6).items_center()
        .child(div().flex_1().text_size(11).font_semibold().text_color(t.dim).child(`REVIEW · ${count}`))
        .when(count === 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(`${this.hint("comment")} on selected lines`))))
      .when(count > 0, (el) => el
        .child(v_flex().id("review-comments").max_h(220).overflow_y_scrollbar().children(items))
        .child(div().id("send-review").mx(8).mt(6).mb(8).h(28).flex().items_center().justify_center().rounded(6).text_size(12)
          .bg(t.solid ?? t.accent).text_color(t.solid_foreground ?? t.foreground).cursor_pointer()
          .on_mouse_down("left", stop).on_click(() => this.sendReview())
          .child(`Send to agent  ${this.hint("send")}`))
        .when(Boolean(this.review), (el) => el.child(div().id("publish-review").mx(8).mb(8).h(28).flex().items_center().justify_center().rounded(6).text_size(12)
          .border_1().border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", stop).on_click(() => this.publish())
          .child(this.publishing ? "Publishing…" : `Publish on ${this.review.label} ${this.review.name}  ${this.hint("publish")}`))));
  }

  modeButton(t, mode, label) {
    return div().id(`mode-${mode}`).px(8).h(22).flex().items_center().rounded(5).text_size(12).cursor_pointer()
      .text_color(this.mode === mode ? t.foreground : t.dim)
      .when(this.mode === mode, (el) => el.bg(t.selected))
      .when(this.mode !== mode, (el) => el.hover((s) => s.bg(t.hover)))
      .on_mouse_down("left", stop)
      .on_click(() => {
        this.mode = mode;
        this.redraw();
      })
      .child(label);
  }

  changesView(t, currentPath) {
    const changes = this.changes;
    const section = (label) => div().px(12).pt(10).pb(4).text_size(11).font_semibold().text_color(t.dim).child(label);
    const rows = [];
    if (!changes) rows.push(div().px(12).py(8).text_size(12).text_color(t.dim).child(this.changesLoading ? "Reading the branch…" : "No changes"));
    else {
      rows.push(div().px(12).pt(8).text_size(11.5).text_color(t.dim).font_family(MONO).truncate().child(`${changes.branch} → ${changes.base}`));
      rows.push(section(`FILES · ${changes.files.length}`));
      changes.files.forEach((file, index) => {
        const added = file.rows.filter((row) => row.kind === "add").length;
        const removed = file.rows.filter((row) => row.kind === "del").length;
        rows.push(this.row(t, `changed-${index}`, 0, file.new_path === currentPath)
          .on_click(() => this.open(file.new_path, null))
          .child(iconElement(fileIcon(file.new_path), t.dim))
          .child(h_flex().flex_1().min_w(0).gap(6).items_center()
            .child(div().min_w(0).truncate().child(basename(file.new_path)))
            .child(div().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(file.new_path.slice(0, -basename(file.new_path).length - 1))))
          .child(div().flex_none().text_size(10.5).text_color("#16a34a").child(added ? `+${added}` : ""))
          .child(div().flex_none().text_size(10.5).text_color("#dc2626").child(removed ? `−${removed}` : "")));
      });
    }
    return v_flex().id("code-changes").flex_1().min_h(0).pb(4).overflow_y_scrollbar().children(rows);
  }

  row(t, id, depth, selected) {
    return h_flex().id(id).h(24).mx(4).min_w(0).overflow_hidden().pr(8).pl(6 + depth * 14).gap(6).items_center().rounded(5)
      .font_family(MONO).text_size(11.5).cursor_pointer().hover((s) => s.bg(t.hover))
      .when(selected, (el) => el.bg(t.selected))
      .on_mouse_down("left", stop);
  }

  searchRows(t, currentPath) {
    if (!this.search.results.length) return [div().px(12).py(6).text_size(12).text_color(t.dim).child("No file matches")];
    return this.search.results.map((index) => {
      const path = this.files[index];
      return this.row(t, `match-${index}`, 0, path === currentPath)
        .on_click(() => this.open(path, null))
        .child(iconElement(fileIcon(path), t.dim))
        .child(div().min_w(0).truncate().child(path));
    });
  }

  treeView(t, currentPath) {
    return this.treeRows().map((row) => this.row(t, `${row.kind}:${row.path}`, row.depth, row.path === currentPath)
      .on_click(() => (row.kind === "folder" ? this.toggle(row.path) : this.open(row.path, null)))
      .child(div().w(12).flex_none().text_size(11).text_color(t.dim).child(row.kind === "folder" ? (row.open ? "▾" : "▸") : ""))
      .child(row.kind === "folder"
        ? iconElement([OWN_ICON(row.open ? "folder-open" : "folder"), null], t.dim)
        : iconElement(fileIcon(row.path), t.dim))
      .child(div().min_w(0).truncate()
        .when(this.changedPaths.has(row.path), (el) => el.text_color(this.changedPaths.get(row.path) === "added" ? "#16a34a" : "#d97706"))
        .child(row.name)));
  }

  editorPane(t) {
    if (!this.current) {
      return v_flex().flex_1().min_w(0).items_center().justify_center().text_color(t.dim)
        .child(this.root ? `Pick a file, or ${this.hint("files")}` : "Loading…");
    }
    const document = this.current;
    return v_flex().flex_1().min_w(0).min_h(0)
      .child(this.tabBar(t))
      .child(h_flex().h(26).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).font_family(MONO).text_size(11).text_color(t.dim)
        .child(div().min_w(0).truncate().child(this.relative(document.path)))
        .child(div().id("copy-path").flex_none().px(5).rounded(4).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
          .when(this.copiedPath === document.path, (el) => el.text_color(CHANGE_COLORS.added))
          .on_mouse_down("left", stop).on_click((_e, cx) => this.copyPath(document, cx))
          .child(this.copiedPath === document.path ? "✓ copied" : "⧉ copy"))
        .when(this.back.length > 0, (el) => el.child(div().child(`${this.hint("back")} back`)))
        .when(this.forward.length > 0, (el) => el.child(div().child(`${this.hint("forward")} forward`))))
      .when(this.findOpen, (el) => el.child(this.findBar(t)))
      .when(Boolean(this.composer), (el) => el.child(h_flex().flex_none().px(12).py(6).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_family(MONO).text_size(11).text_color(COMMENT_COLOR).child(where(this.composer)))
        .child(Input.new(this.commentInput).flex_1().h(28).text_size(12.5))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("⏎ add · Esc cancel"))))
      .when(Boolean(this.peek) && !this.diffVisible(document), (el) => el.child(this.peekPanel(t)))
      .child(div().flex().flex_col().flex_1().min_h(0).min_w(0)
        .on_mouse_up("right", () => this.cx.timer.after(0, () => this.findReferences()))
        .child(Editor.new(this.activeState(document)).flex_1().min_h(0)))
      .when(Boolean(this.references), (el) => el.child(this.referencesPanel(t)));
  }

  copyPath(document, cx) {
    cx.write_to_clipboard(this.relative(document.path));
    this.copiedPath = document.path;
    this.redraw();
    this.cx.timer.after(1500, () => {
      if (this.copiedPath !== document.path) return;
      this.copiedPath = null;
      this.redraw();
    });
  }

  tabBar(t) {
    return h_flex().id("code-tabs").h(34).flex_none().border_b(1).border_color(t.border).overflow_x_scrollbar().track_scroll(this.tabScroll)
      .children(this.tabs.map((path) => {
        const document = this.documents.get(path);
        const active = document === this.current;
        return h_flex().id(`tab:${path}`).h_full().flex_none().pl(12).pr(6).gap(6).items_center().border_r(1).border_color(t.border)
          .font_family(MONO).text_size(12).cursor_pointer()
          .text_color(active ? t.foreground : t.dim)
          .when(active, (el) => el.bg(t.selected))
          .when(!active, (el) => el.hover((s) => s.bg(t.hover)))
          .on_mouse_down("left", stop).on_click(() => this.open(path, null))
          .child(iconElement(fileIcon(path), t.dim))
          .child(div().child(basename(path)))
          .child(div().id(`close:${path}`).w(16).h(16).flex().items_center().justify_center().rounded(4).text_size(11)
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_mouse_down("left", stop)
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.closeTab(path);
            })
            .child(document?.dirty ? "●" : "×"));
      }));
  }

  footer(t) {
    const document = this.current;
    const counts = [1, 2].map((severity) => document?.diagnostics.filter((d) => (d.severity ?? 1) === severity).length ?? 0);
    const servers = Object.entries(this.serverStatus).map(([name, status]) => `${name}: ${status}`).join(" · ");
    return h_flex().h(26).flex_none().px(12).gap(14).items_center().border_t(1).border_color(t.border).text_size(11.5).text_color(t.dim)
      .child(div().child(`${counts[0]} errors · ${counts[1]} warnings`))
      .child(div().min_w(0).truncate().child(servers || "no language server"))
      .child(div().flex_1())
      .child(div().min_w(0).truncate().child(this.message))
      .child(div().id("shortcuts-hint").px(6).rounded(4).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click(() => this.toggleShortcuts())
        .child(`Shortcuts ${this.hint("shortcuts")}`));
  }
}
