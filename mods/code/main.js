import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor, EditorState, ScrollHandle, Scrollbar, TextView, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { theme, props, focused, exec, home, appHome, readTextFile, writeTextFile, closeOverlay, run, watchFolder, shared, setShared } from "herdr";
import { launch, fileUri, uriPath } from "./lsp.js";
import { dockerLanguage } from "./docker.js";
import { plainCompletion } from "./snippet.js";
import { syntaxOf } from "./syntax.js";
import { deleteLines, cutLines, moveLines, duplicateLines } from "./lines.js";
import { branchDiff, workingDiff, commitGraph, commitDiff, agentLabel } from "./review/local.js";
import { lineDiff } from "./review/diff.js";
import { findReview, publishReview, reviewThreads, replyThread, resolveThread } from "./review/forge.js";
import { AgentSession, CHANGE_COLORS, COMMENT_COLOR, changeAt, changeHighlights, lineRange, reviewPrompt, where } from "./review/review.js";

const MONO = "JetBrains Mono";
const SHOWN_FILES = 200;
const SIDE_W = 300;
const SIDE_MIN = 160;
const SIDE_MAX = 900;
const REFERENCES_LIMIT = 500;
const SYMBOL_LIMIT = 200;
const SYMBOL_KINDS = ["", "file", "module", "namespace", "package", "class", "method", "property", "field", "constructor", "enum", "interface",
  "function", "variable", "constant", "string", "number", "boolean", "array", "object", "key", "null", "enum member", "struct", "event", "operator", "type"];
const MOD_DIR = () => `${appHome()}/mods/code`;
const CACHE_DIR = () => `${home()}/.cache/herdr-code`;
const COMMENTS_FILE = () => `${CACHE_DIR()}/comments.json`;
const COMMENTS_KEY = "code.comments";
const readComments = async () => {
  try { return JSON.parse((await readTextFile(COMMENTS_FILE())) ?? "{}") ?? {}; } catch { return {}; }
};
const SERVERS_DIR = () => `${CACHE_DIR()}/servers`;
const stop = (_e, cx) => cx.stop_propagation();
// ctrl + the platform key (Super on Linux) held with a click: show where the symbol is used. Super alone moves windows on Omarchy,
// ctrl alone is the editor's go to definition, so the two together are free.
const usesChord = (modifiers) => Boolean(modifiers?.control && modifiers?.platform);

const patchValue = (state, next) => {
  const prev = state.value();
  if (prev === next) return false;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start += 1;
  let tail = 0;
  while (tail < prev.length - start && tail < next.length - start && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
  state.set_selected_range({ start, end: prev.length - tail });
  state.replace(next.slice(start, next.length - tail));
  if (state.value() === next) return false;
  state.set_value(next);
  return true;
};

const UNDO_GROUP_MS = 800;
const UNDO_DEPTH = 300;

const ownHistoryEditor = (options) => {
  try {
    return EditorState.new({ ...options, history: false });
  } catch {
    return EditorState.new(options);
  }
};

const firstDifference = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

const ACTIONS = [
  { id: "undo", key: "ctrl-z", aliases: ["cmd-z"], label: "Undo", run: (view) => view.stepHistory(-1) },
  { id: "redo", key: "ctrl-shift-z", aliases: ["cmd-shift-z", "ctrl-y"], label: "Redo", run: (view) => view.stepHistory(1) },
  { id: "files", key: "ctrl-p", label: "Find a file", run: (view) => view.focusFinder() },
  { id: "search", key: "cmd-shift-f", aliases: ["ctrl-shift-f"], label: "Find and replace in the project", run: (view) => view.startGrep() },
  { id: "sidebar", key: "ctrl-b", label: "Show or hide the sidebar", run: (view) => view.toggleSidebar() },
  { id: "changes", key: "ctrl-shift-g", label: "Switch between files and changes", run: (view) => view.toggleChanges() },
  { id: "preview", key: "ctrl-shift-v", label: "Show or hide the Markdown preview", run: (view) => view.togglePreview() },
  { id: "comment", key: "ctrl-k", label: "Comment the selected lines", run: (view) => view.startComment() },
  { id: "send", key: "ctrl-enter", label: "Send the review to the agent", run: (view) => view.sendReview() },
  { id: "publish", key: "ctrl-shift-enter", label: "Publish the review on the MR/PR", run: (view) => view.publish() },
  { id: "save", key: "ctrl-s", label: "Save", run: (view) => view.save() },
  { id: "close", key: "ctrl-w", label: "Close the tab", run: (view) => view.current && view.closeTab(view.current.path) },
  // Line edits, in the editor only. They answer false when the key is not theirs (the keyboard is in another field, or a cut has a selection).
  { id: "deleteLine", key: "ctrl-d", label: "Delete the line", run: (view, cx) => view.editLines(deleteLines, cx) },
  { id: "cutLine", key: "ctrl-x", aliases: ["cmd-x"], label: "Cut the selection, or the line when nothing is selected", run: (view, cx) => view.editLines(cutLines, cx) !== false || view.clipboard("cut", cx) },
  { id: "copy", key: "ctrl-c", label: "Copy the selection", run: (view, cx) => view.clipboard("copy", cx) },
  { id: "paste", key: "ctrl-v", label: "Paste", run: (view, cx) => view.clipboard("paste", cx) },
  { id: "moveLineUp", key: "alt-up", label: "Move the line up", run: (view, cx) => view.editLines(moveLines(-1), cx) },
  { id: "moveLineDown", key: "alt-down", label: "Move the line down", run: (view, cx) => view.editLines(moveLines(1), cx) },
  { id: "duplicateLine", key: "ctrl-shift-d", label: "Duplicate the line", run: (view, cx) => view.editLines(duplicateLines, cx) },
  { id: "definition", key: "f12", label: "Go to definition", run: (view) => view.goToDefinition() },
  { id: "find", key: "cmd-f", aliases: ["ctrl-f"], label: "Find in the file", run: (view) => view.startFind() },
  { id: "references", key: "shift-f12", label: "Show where it is used", run: (view) => view.findReferences() },
  { id: "back", key: "ctrl--", label: "Go back", run: (view) => view.goBack() },
  { id: "forward", key: "ctrl-=", aliases: ["ctrl-+", "ctrl-shift-="], label: "Go forward", run: (view) => view.goForward() },
  { id: "threads", key: "ctrl-alt-m", label: "Show or hide the MR comments in the code", run: (view) => view.toggleThreads() },
  { id: "resolveThread", key: "ctrl-alt-r", label: "Resolve or reopen the MR thread under the cursor", run: (view) => view.resolveAtCursor() },
  { id: "foldThread", key: "ctrl-alt-f", label: "Hide or show the MR thread under the cursor", run: (view) => view.foldAtCursor() },
  { id: "fold", key: "ctrl-alt-[", label: "Fold or unfold the block", run: (view) => view.toggleFold() },
  { id: "splitDiff", key: "ctrl-alt-s", label: "Split or stacked diff", run: (view) => view.toggleSplitDiff() },
  { id: "nextChange", key: "ctrl-alt-down", label: "Next change", run: (view) => view.stepChange(1) },
  { id: "previousChange", key: "ctrl-alt-up", label: "Previous change", run: (view) => view.stepChange(-1) },
  { id: "nextTab", key: "ctrl-alt-right", label: "Next tab", run: (view) => view.cycleTab(1) },
  { id: "previousTab", key: "ctrl-alt-left", label: "Previous tab", run: (view) => view.cycleTab(-1) },
  { id: "shortcuts", key: "ctrl-/", label: "Show the shortcuts", run: (view) => view.toggleShortcuts() },
];

const FIXED_SHORTCUTS = [["cmd-click", "Go to definition"], ["ctrl-click, right click", "Show where it is used"], ["ctrl-cmd-click", "Show where it is used"], ["middle-click", "Close a tab (click it)"], ["down", "File finder: next file (⏎ opens it)"], ["up", "File finder: previous file"], ["escape", "Back to the editor, or cancel"]];

const KEY_SYMBOLS = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", enter: "⏎", escape: "Esc", left: "←", right: "→", up: "↑", down: "↓", tab: "⇥", click: " click", middle: "Middle" };

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

const TOFU_LS_VERSION = "0.5.3";
const INSTALL_TOFU_LS = [
  'set -e; dir=$(mktemp -d); cd "$dir"',
  'os=$(uname -s); arch=$(uname -m); [ "$arch" = aarch64 ] && arch=arm64',
  'archive="tofu-ls_${os}_${arch}.tar.gz"; base="https://github.com/opentofu/tofu-ls/releases/download/v$2"',
  'curl -fsSLO "$base/$archive"; curl -fsSLO "$base/tofu-ls_$2_checksums.txt"',
  'grep " $archive$" "tofu-ls_$2_checksums.txt" | shasum -a 256 -c - >/dev/null',
  'tar -xzf "$archive"; mkdir -p "$1/bin"; mv tofu-ls "$1/bin/tofu-ls"; cd /; rm -rf "$dir"',
].join("\n");

// ShellCheck, which bash-language-server lints with: the official release, pinned, with the checksum GitHub records for each build.
const SHELLCHECK_VERSION = "0.11.0";
const SHELLCHECK_SHA256 = {
  "linux.x86_64": "8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198",
  "linux.aarch64": "12b331c1d2db6b9eb13cfca64306b1b157a86eb69db83023e261eaa7e7c14588",
  "darwin.x86_64": "3c89db4edcab7cf1c27bff178882e0f6f27f7afdf54e859fa041fca10febe4c6",
  "darwin.aarch64": "56affdd8de5527894dca6dc3d7e0a99a873b0f004d7aabc30ae407d3f48b0a79",
};
const INSTALL_SHELLCHECK = [
  'set -e; dir=$(mktemp -d); cd "$dir"',
  'os=$(uname -s | tr A-Z a-z); arch=$(uname -m); [ "$arch" = arm64 ] && arch=aarch64',
  'case "$os.$arch" in',
  ...Object.entries(SHELLCHECK_SHA256).map(([target, sum]) => `  ${target}) sum=${sum};;`),
  '  *) echo "no ShellCheck build for $os $arch" >&2; exit 1;;',
  "esac",
  'archive="shellcheck-v$2.$os.$arch.tar.xz"',
  'curl -fsSLO "https://github.com/koalaman/shellcheck/releases/download/v$2/$archive"',
  'if command -v sha256sum >/dev/null; then check="sha256sum -c -"; else check="shasum -a 256 -c -"; fi',
  'echo "$sum  $archive" | $check >/dev/null',
  'tar -xJf "$archive"; mkdir -p "$1/bin"; mv "shellcheck-v$2/shellcheck" "$1/bin/shellcheck"; cd /; rm -rf "$dir"',
].join("\n");

// A server: what runs it (`command`), what installs it (`install`, and `package` for npm), where it works (`workspace`), and what is
// particular to it, if anything:
//   prepare(view, { command, cwd, configured }) -> { command, settings, options }: another command to run, the settings it asks for
//     (`workspace/configuration`) and its initialization options (the settings, when not given); `configured` is a command from the config;
//   connected(view, client): once it is running, before it is initialized.
const npmServer = (pkg, bin, ...args) => ({ package: pkg, command: () => [`${SERVERS_DIR()}/node_modules/.bin/${bin}`, ...args], install: "npm" });

// A repository with its own postgres-language-server.jsonc keeps it (its database, its lints); the others get the mod's, which leaves
// the syntax errors (postgres/postgres-language-server.jsonc).
const postgresConfig = async (_view, { command, cwd, configured }) => {
  if (configured || (await exec("test", ["-f", `${cwd}/postgres-language-server.jsonc`])).code === 0) return {};
  return { command: [...command, `--config-path=${MOD_DIR()}/postgres`] };
};

// Without ShellCheck bash-language-server completes and goes to definitions but reports no error. One on the PATH is used; otherwise the
// release above is downloaded once next to the other servers. Optional: if that fails the server starts without it.
const shellcheckSettings = async (view, { configured }) => {
  if (configured || (await exec("sh", ["-c", "command -v shellcheck"])).code === 0) return {};
  const binary = `${SERVERS_DIR()}/bin/shellcheck`;
  try {
    await view.install("bash", "shellcheck", binary);
    return { settings: { bashIde: { shellcheckPath: binary } } };
  } catch {
    return {};
  }
};

const SERVERS = {
  python: {
    command: () => ["uvx", "ty", "server"],
    async prepare(view, { command }) {
      const venv = await view.findVenv();
      if (!venv) return {};
      return { command: ["env", `VIRTUAL_ENV=${venv}`, ...command], settings: { python: { pythonPath: `${venv}/bin/python` } } };
    },
  },
  rust: {
    command: () => ["rust-analyzer"],
    install: "rustup",
    workspace: "Cargo.toml",
    prepare: (_view, { cwd }) => {
      const settings = { "rust-analyzer": { linkedProjects: [`${cwd}/Cargo.toml`] } };
      return { settings, options: settings["rust-analyzer"] };
    },
  },
  go: { command: () => ["gopls"] },
  opentofu: { command: () => [`${SERVERS_DIR()}/bin/tofu-ls`, "serve"], install: "tofu-ls" },
  typescript: { ...npmServer("@vtsls/language-server", "vtsls", "--stdio"), prepare: () => ({ settings: typescriptSettings() }) },
  vue: { ...npmServer("@vue/language-server", "vue-language-server", "--stdio"), connected: (view, client) => view.relayToTypescript(client) },
  bash: { ...npmServer("bash-language-server", "bash-language-server", "start"), prepare: shellcheckSettings },
  dockerfile: npmServer("dockerfile-language-server-nodejs", "docker-langserver", "--stdio"),
  compose: npmServer("@microsoft/compose-language-service", "docker-compose-langserver", "--stdio"),
  postgres: { ...npmServer("@postgres-language-server/cli", "postgres-language-server", "lsp-proxy"), prepare: postgresConfig },
};

// What `npm install` fetches: the servers' packages, and the Vue plugin that vtsls loads (typescriptSettings), which has no server of its own.
const NPM_SERVERS = [...new Set([...Object.values(SERVERS).map((spec) => spec.package), "@vue/typescript-plugin"])].filter(Boolean);

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
  sql: { servers: ["postgres"], id: "sql" },
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

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const isMarkdown = (path) => MARKDOWN_EXTENSIONS.has(extensionOf(path));

// A link of a Markdown file as a path of the repository: relative to the file's folder, or to the root when it starts with "/".
// Null for an anchor, an address, or a path that leaves the repository.
const linkedPath = (from, url) => {
  let target = String(url ?? "").split(/[#?]/)[0];
  try { target = decodeURIComponent(target); } catch { /* keep it as written */ }
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const parts = target.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
};

const shebangOf = (text) => /^#!\S*?\b(?:env\s+)?(sh|bash|zsh|dash|ksh)\b/.exec(text)?.[1] ?? null;

// By file name first (a Dockerfile has no extension), then by extension, then by the shebang of a script.
const languageOf = (path, text) => dockerLanguage(basename(path)) ?? LANGUAGES[extensionOf(path)] ?? (shebangOf(text) ? SHELL : null);

const FIND_LIMIT = 2000;
const GREP_LIMIT = 5000;
const GREP_LINE_CHARS = 2000;
const LIST_ROW = 24;
const FILE_HEADER_ROW = 26;
const PEEK_ROW = 18;
const groupByFile = (entries, prefix) => {
  const items = [];
  entries.forEach((entry, index) => {
    if (entry.path !== entries[index - 1]?.path) {
      let count = 0;
      while (entries[index + count]?.path === entry.path) count++;
      items.push({ kind: "file", key: `${prefix}-file-${index}`, path: entry.path, count, height: FILE_HEADER_ROW });
    }
    items.push({ kind: "entry", key: `${prefix}-${index}`, index, entry });
  });
  return items;
};
const grepItems = (matches) => groupByFile(matches, "grep");
const LINE_COUNTS = new WeakMap();
const lineCounts = (file) => {
  let counts = LINE_COUNTS.get(file);
  if (!counts || counts.rows !== file.rows) {
    counts = { rows: file.rows, added: 0, removed: 0 };
    for (const row of file.rows) {
      if (row.kind === "add") counts.added++;
      else if (row.kind === "del") counts.removed++;
    }
    LINE_COUNTS.set(file, counts);
  }
  return counts;
};
const GREP_DEBOUNCE = 500;
const REFERENCE_COLOR = "#eab30826";
const PEEK_BG = "#ef444412";
const DIFF_DELETED = "#ef44441a";
const DELETED_MARK = "\u2212 ";
const LIVE_DIFF_DELAY = 300;
const CHANGE_DELAY = 150;
const DIFF_SYNC_DELAY = 100;
const DIFF_ADDED = "#22c55e12";
const DIFF_GAP = "#8080800f";
const COMMIT_ROWS = 20000;
const GRAPH_ROW = 22;
const DIFF_ROW = 18;
const laneRuns = (graph) => {
  const runs = [];
  [...graph].forEach((char, column) => {
    const lane = column >> 1;
    const text = char === " " ? "\u00a0" : char === "*" ? "●" : char;
    const last = runs[runs.length - 1];
    if (last && (last.lane === lane || char === " ")) last.text += text;
    else runs.push({ lane, text });
  });
  return runs;
};
const LANE_COLORS = ["#3b82f6", "#f59e0b", "#a855f7", "#14b8a6", "#ef4444", "#84cc16"];
const NOTE_MARK = "\u2503 ";
const NOTE_BG = "#f59e0b1c";
const NOTE_LINES = 40;
const isVirtual = (line) => line.startsWith(DELETED_MARK) || line.startsWith(NOTE_MARK);
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

const workspaceEdits = (edit) => {
  const byPath = new Map();
  const add = (uri, edits) => {
    if (!String(uri).startsWith("file://") || !edits?.length) return;
    const path = uriPath(uri);
    byPath.set(path, [...(byPath.get(path) ?? []), ...edits]);
  };
  for (const change of edit?.documentChanges ?? []) {
    if (change.kind) throw new Error(`the rename also wants to ${change.kind} files, not supported here`);
    add(change.textDocument.uri, change.edits);
  }
  if (!edit?.documentChanges) for (const [uri, edits] of Object.entries(edit?.changes ?? {})) add(uri, edits);
  return byPath;
};

const wordIndex = (text, name, from) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "g");
  found.lastIndex = from;
  return found.exec(text)?.index ?? -1;
};

const shiftedPosition = (position, edits) => {
  const before = edits.filter((edit) => edit.range.start.line === position.line && edit.range.end.line === position.line
    && edit.range.end.character <= position.character);
  const delta = before.reduce((sum, edit) => sum + (edit.newText ?? "").length - (edit.range.end.character - edit.range.start.character), 0);
  return { line: position.line, character: position.character + delta };
};

const applyTextEdits = (text, edits) => {
  const ranges = edits.map((edit) => ({ start: offsetOf(text, edit.range.start), end: offsetOf(text, edit.range.end), newText: edit.newText ?? "" }))
    .sort((a, b) => b.start - a.start || b.end - a.end);
  return ranges.reduce((out, { start, end, newText }) => out.slice(0, start) + newText + out.slice(end), text);
};

const positionOf = (text, offset) => {
  let line = 0;
  for (let at = text.indexOf("\n"); at !== -1 && at < offset; at = text.indexOf("\n", at + 1)) line++;
  return { line, character: offset - (text.lastIndexOf("\n", offset - 1) + 1) };
};

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path) => path.slice(0, Math.max(path.lastIndexOf("/"), 0)) || "/";

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
    this.changesFilter = InputState.new({ placeholder: "Filter the files (regex, ! to exclude)" });
    this.changesFilter.on("change", () => this.redraw());
    this.grepInput = InputState.new({ placeholder: "Find in the project" });
    this.grepInput.on("change", () => this.queueGrep(GREP_DEBOUNCE));
    this.grepInput.on("submit", () => this.queueGrep(0));
    this.searchTab = "text";
    this.symbol = { current: null, items: [], loading: false, results: [], searching: false, renaming: false, message: "", seq: 0, selected: null };
    this.symbolInput = InputState.new({ placeholder: "Find a symbol by name" });
    this.symbolInput.on("change", () => this.queueSymbolSearch());
    this.renameInput = InputState.new({ placeholder: "Rename to" });
    this.renameInput.on("submit", () => this.renameSymbol());
    this.replaceInput = InputState.new({ placeholder: "Replace with" });
    this.replaceInput.on("submit", () => this.acceptMatch());
    this.peek = null;
    this.peekAt = null;
    cx.timer.every(200, () => this.updatePeek());
    cx.timer.every(100, () => this.syncPreview());
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
    this.working = null;
    this.scope = "all";
    this.graph = null;
    this.graphLoading = false;
    this.commit = null;
    this.changedPaths = new Map();
    this.changesLoading = false;
    this.comments = [];
    this.instance = `${Date.now()}-${Math.random()}`;
    this.threads = [];
    this.threadsShown = true;
    this.splitDiff = false;
    this.splitLeader = "right";
    this.foldToggled = new Set();
    this.review = null;
    this.publishing = false;
    this.composer = null;
    this.agentName = "the agent";
    this.commentInput = InputState.new({ placeholder: "Comment for the agent…" });
    this.commentInput.on("submit", () => this.addComment());
    this.treeScroll = VirtualListScrollHandle.new();
    this.tabScroll = ScrollHandle.new();
    this.pointerModifiers = null;
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
    this.typing = null;
    this.finderAt = 0;
    this.finderQuery = "";
    this.finderFocus = false;
    this.finder = InputState.new({ placeholder: "Find a file" });
    this.finder.on("change", () => {
      this.refreshSearch();
      this.redraw();
    });
    this.finder.on("submit", () => {
      const index = this.search.results[this.finderAt];
      if (index !== undefined) this.open(this.files[index], null);
    });
    this.finder.on("focus", () => { this.finderFocus = true; });
    this.finder.on("blur", () => { this.finderFocus = false; });
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
      if (props()?.path) {
        await this.open(props().path, props().line ? { line: props().line - 1, character: 0 } : null);
        if (props().preview && this.current && isMarkdown(this.current.path)) this.current.preview = true;
      } else cx.timer.after(50, () => this.finder.focus());
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
    if (this.searchTab === "symbol") {
      this.pickSymbolAtCursor();
      return;
    }
    if (document) {
      const { start, end } = document.state.selected_range();
      const selected = document.state.value().slice(Math.min(start, end), Math.max(start, end));
      if (selected && !selected.includes("\n")) this.grepInput.set_value(selected);
    }
    this.grepInput.focus();
    this.queueGrep(0);
  }

  setSearchTab(tab) {
    this.searchTab = tab;
    if (tab === "symbol") this.pickSymbolAtCursor();
    else this.grepInput.focus();
    this.redraw();
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
      this.grep = { ...this.grep, matches: [], items: [], index: -1, loading: false, message: "" };
      this.redraw();
      return;
    }
    this.grep.loading = true;
    this.redraw();
    const args = ["-C", this.root, "grep", "-n", "-I", "--untracked", "--no-color", "--full-name", "-F", ...(this.grep.caseSensitive ? [] : ["-i"]), "-e", query, "--", "."];
    const capped = `git "$@" | cut -c1-${GREP_LINE_CHARS} | head -n ${GREP_LIMIT}; exit "\${PIPESTATUS[0]:-0}"`;
    this.grep.running = true;
    const result = await exec("bash", ["-c", capped, "bash", ...args], { timeout: 120000 }).catch((error) => ({ code: 2, stdout: "", stderr: String(error?.message ?? error) }));
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
        const lead = text.slice(Math.max(0, at - 64), at).replace(/^\s+/, "");
        matches.push({ path, line: Number(number) - 1, start: at, end: at + query.length,
          lead: lead.length > 24 ? `…${lead.slice(-24)}` : lead, hit: text.slice(at, at + query.length), tail: text.slice(at + query.length, at + query.length + 200) });
      }
      if (matches.length >= GREP_LIMIT) break;
    }
    const message = result.code > 1 && result.code !== 141 ? (result.stderr || "git grep failed").trim().split("\n").pop() : "";
    this.grep = { ...this.grep, matches, items: grepItems(matches), index: matches.length ? 0 : -1, loading: false, message, pending: false };
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
    this.grep.items = grepItems(this.grep.matches);
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
    this.grep.items = grepItems(this.grep.matches);
    if (this.grep.index >= this.grep.matches.length) this.grep.index = this.grep.matches.length - 1;
  }

  async replaceAll() {
    const replacement = this.replaceInput.value();
    const byPath = new Map();
    for (const match of this.grep.matches) {
      if (!byPath.has(match.path)) byPath.set(match.path, []);
      byPath.get(match.path).push(match);
    }
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
    this.grep.items = [];
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
    const draw = (item) => {
      if (item.kind === "file") return this.fileHeader(t, item);
      const match = item.entry;
      return this.row(t, item.key, 1, item.index === index)
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(match.line + 1)))
        .child(h_flex().flex_1().min_w(0).overflow_hidden()
          .child(div().flex_none().text_color(t.dim).child(match.lead))
          .child(div().flex_none().rounded(2).bg(FIND_COLOR).text_color(t.foreground).child(match.hit))
          .child(div().min_w(0).truncate().text_color(t.dim).child(match.tail)));
    };
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
      .child(this.rowList("grep-results", this.grep.items ?? [], draw, (item) => item.kind === "entry" && this.showMatch(item.index)));
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
      this.refreshFiles().catch(() => {});
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
      this.resetHistory(document);
      document.dirty = false;
      document.state.set_selected_range({ start: Math.min(start, text.length), end: Math.min(end, text.length) });
    }
    this.redraw();
  }

  async loadChanges() {
    if (this.isRepo === false) return;
    if (this.changesLoading) {
      this.changesAgain = true;
      return;
    }
    this.changesLoading = true;
    this.redraw();
    try {
      let changes = await branchDiff(exec, this.root, { base: this.review?.target ?? null });
      this.review = await findReview(this.root, changes.branch).catch(() => null);
      if (this.review?.target && changes.base !== `origin/${this.review.target}`) {
        const stacked = await branchDiff(exec, this.root, { base: this.review.target });
        if (stacked.base === `origin/${this.review.target}`) changes = stacked;
      }
      this.changes = changes;
      this.working = await workingDiff(exec, this.root);
      await this.loadThreads();
      this.applyScope();
      if (this.graph) this.loadGraph();
    } catch (error) {
      this.message = `Changes: ${String(error?.message ?? error).split("\n")[0]}`;
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
      .child(v_flex().h(Math.min(old.length, 8) * PEEK_ROW + 4).flex_none().font_family(MONO).text_size(12)
        .child(this.rowList("peek-lines", old.map((text, i) => ({ key: `peek-${i}`, text, height: PEEK_ROW })), (item) => h_flex().id(item.key).h(PEEK_ROW).px(12).gap(10).min_w(0)
          .child(div().flex_none().text_color(t.dim).child(String(oldStart + Number(item.key.slice(5))).padStart(width)))
          .child(div().flex_none().text_color(CHANGE_COLORS.deleted).child("−"))
          .child(div().min_w(0).truncate().text_color(t.foreground).child(item.text.replace(/\t/g, "  ") || " ")), () => {})));
  }

  shownChanges() {
    if (this.scope !== "uncommitted" || !this.changes) return this.changes;
    return { ...this.changes, ...(this.working ?? { base: "HEAD", fork: null, files: [] }) };
  }

  applyScope() {
    const files = this.shownChanges()?.files ?? [];
    this.changedPaths = new Map(files.map((file) => [file.new_path, file.new_file ? "added" : "modified"]));
    for (const document of this.documents.values()) this.paintChanges(document);
    this.peekAt = null;
    if (this.current) this.updatePeek();
  }

  setScope(scope) {
    if (this.scope === scope) return;
    this.scope = scope;
    this.applyScope();
    this.redraw();
  }

  async loadGraph() {
    if (this.graphLoading) return;
    this.graphLoading = true;
    this.redraw();
    try {
      this.graph = await commitGraph(exec, this.root, { refs: this.changes?.base ? [this.changes.base] : [] });
    } catch (error) {
      this.message = `Graph: ${error?.message ?? error}`;
    }
    this.graphLoading = false;
    this.redraw();
  }

  async showCommit(sha) {
    this.commit = { sha, loading: true };
    this.redraw();
    try {
      const commit = await commitDiff(exec, this.root, sha);
      if (this.commit?.sha === sha) this.commit = commit;
    } catch (error) {
      if (this.commit?.sha === sha) this.commit = null;
      this.message = `Commit: ${error?.message ?? error}`;
    }
    this.redraw();
  }

  closeCommit() {
    this.commit = null;
    this.redraw();
  }

  changedFile(path) {
    const relative = this.relative(path);
    return this.shownChanges()?.files.find((file) => file.new_path === relative) ?? null;
  }

  paintChanges(document) {
    this.ensureBase(document);
    this.buildDiff(document);
  }

  async ensureBase(document) {
    const file = this.changedFile(document.path);
    const fork = this.shownChanges()?.fork;
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
    if (document.baseText === undefined || document.baseKey !== `${this.shownChanges()?.fork}:${file.old_path}`) return file.rows;
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
      this.dropSplit(document);
      return null;
    }
    const fileRows = this.diffRows(document, file);
    const changes = changeHighlights(fileRows);
    const changesKey = JSON.stringify(changes);
    if (document.changesKey !== changesKey) {
      document.changesKey = changesKey;
      document.state.set_highlights("changes", changes);
    }
    const lines = document.state.value().split("\n");
    const deleted = new Map();
    const added = new Set();
    for (const row of fileRows) {
      if (row.kind === "del") deleted.set(row.newPos, [...(deleted.get(row.newPos) ?? []), row.text]);
      else if (row.kind === "add") added.add(row.new);
    }
    const out = [];
    const kinds = [];
    const left = [];
    const leftKinds = [];
    const split = this.splitDiff;
    const notes = new Map();
    const relative = this.relative(document.path);
    const threadsHere = this.threadsShown ? this.threads.filter((thread) => thread.path === relative) : [];
    const pushNotes = (line) => {
      const push = (text, thread) => {
        out.push(`${NOTE_MARK}${text}`);
        kinds.push("note");
        left.push("");
        leftKinds.push("note");
        notes.set(out.length - 1, thread);
      };
      for (const thread of threadsHere.filter((x) => x.line === line)) {
        const count = `${thread.notes.length} comment${thread.notes.length > 1 ? "s" : ""}`;
        if (this.threadFolded(thread)) {
          push(`${thread.resolved ? "✅ RESOLVED" : "🟠 OPEN"} · ${this.authorLabel(thread.notes[0].author)} · ${count} · hidden, ${this.hint("foldThread")} shows it`, thread);
          continue;
        }
        thread.notes.forEach((note, n) => {
          const body = note.body.split("\n");
          const shown = body.length > NOTE_LINES ? [...body.slice(0, NOTE_LINES), "…"] : body;
          shown.forEach((text, k) => {
            const head = k === 0 ? `${n === 0 ? `${thread.resolved ? "✅ RESOLVED" : "🟠 OPEN"} · ` : "  ↳ "}${this.authorLabel(note.author)}: ` : "     ";
            push(`${head}${text}`, thread);
          });
        });
        push(`     cursor on this thread, then ${this.hint("comment")} reply on the MR · ${this.hint("resolveThread")} ${thread.resolved ? "reopen" : "resolve"} · ${this.hint("foldThread")} hide`, thread);
      }
    };
    const pushDeleted = (at) => {
      for (const text of deleted.get(at) ?? []) {
        out.push(`${DELETED_MARK}${text}`);
        kinds.push("del");
      }
    };
    if (split) {
      for (let i = 0; ;) {
        let run = 0;
        while (i + run < lines.length && added.has(i + run + 1)) run++;
        const gone = Array.from({ length: run + 1 }, (_, k) => deleted.get(i + k + 1) ?? []).flat();
        for (let k = 0; k < Math.max(gone.length, run); k++) {
          out.push(k < run ? lines[i + k] : DELETED_MARK);
          kinds.push(k < run ? "add" : "gap");
          left.push(k < gone.length ? gone[k] : "");
          leftKinds.push(k < gone.length ? "del" : "gap");
          if (k < run) pushNotes(i + k + 1);
        }
        i += run;
        if (i >= lines.length) break;
        out.push(lines[i]);
        kinds.push("ctx");
        left.push(lines[i]);
        leftKinds.push("ctx");
        pushNotes(++i);
      }
    } else {
      lines.forEach((text, i) => {
        pushDeleted(i + 1);
        out.push(text);
        kinds.push(added.has(i + 1) ? "add" : "ctx");
        pushNotes(i + 1);
      });
      pushDeleted(lines.length + 1);
    }
    const value = out.join("\n");
    if (!document.diff) {
      const state = ownHistoryEditor({ language: syntaxOf(basename(document.path), extensionOf(document.path), document.language), value, font_family: MONO, folding: !split });
      document.diff = { state, value, deleted: out.filter(isVirtual) };
      state.on("change", () => this.queueDiffSync(document));
      this.trackTyping(document, state);
      this.applyDiffLsp(document);
    } else if (document.diff.state.value() !== value) {
      const range = this.realRange(document);
      document.diff.value = value;
      document.diff.deleted = out.filter(isVirtual);
      document.diff.syncing = true;
      if (patchValue(document.diff.state, value)) document.diff.labelKey = document.diff.highlightKey = undefined;
      document.diff.syncing = false;
      this.selectReal(document, range);
    }
    document.diff.kinds = kinds;
    document.diff.notes = notes;
    this.labelDiff(document);
    const highlightKey = kinds.join("");
    if (document.diff.highlightKey !== highlightKey) {
      document.diff.highlightKey = highlightKey;
      document.diff.state.set_highlights("diff", kinds.flatMap((kind, i) => (kind === "ctx" ? [] : [{
        range: { start: { line: i, character: 0 }, end: { line: i + 1, character: 0 } },
        color: kind === "del" ? DIFF_DELETED : kind === "note" ? NOTE_BG : kind === "gap" ? DIFF_GAP : DIFF_ADDED,
      }])));
    }
    if (split) this.buildSplit(document, left, leftKinds);
    else this.dropSplit(document);
    return document.diff;
  }

  buildSplit(document, lines, kinds) {
    const right = document.diff.state;
    if (typeof right.set_scroll_top !== "function") return;
    const value = lines.join("\n");
    if (!document.split) {
      const state = EditorState.new({ language: syntaxOf(basename(document.path), extensionOf(document.path), document.language), value, font_family: MONO, folding: false, readonly: true });
      document.split = { state };
      const follow = (side, from, to) => {
        if (this.splitLeader !== side) return;
        const top = from.scroll_top();
        const there = to.scroll_top();
        if (top !== null && (there === null || Math.abs(top - there) > 0.5)) to.set_scroll_top(top);
      };
      state.on("scroll", () => { if (document.split?.state === state && document.diff) follow("left", state, document.diff.state); });
      if (!document.diff.followed) {
        document.diff.followed = true;
        right.on("scroll", () => { if (document.split && document.diff?.state === right) follow("right", right, document.split.state); });
      }
    } else if (document.split.state.value() !== value) {
      document.split.state.set_value(value);
    }
    const key = kinds.join("");
    if (document.split.key === key) return;
    document.split.key = key;
    let line = 0;
    document.split.state.set_line_labels(kinds.map((kind) => (kind === "ctx" || kind === "del" ? String(++line) : "")));
    document.split.state.set_highlights("diff", kinds.flatMap((kind, i) => (kind === "ctx" || kind === "note" ? [] : [{
      range: { start: { line: i, character: 0 }, end: { line: i + 1, character: 0 } },
      color: kind === "del" ? DIFF_DELETED : DIFF_GAP,
    }])));
    const top = right.scroll_top();
    if (top !== null) document.split.state.set_scroll_top(top);
  }

  dropSplit(document) {
    if (!document.split) return;
    document.split.state.release();
    document.split = null;
  }

  toggleSplitDiff() {
    if (this.current?.diff && typeof this.current.diff.state.set_scroll_top !== "function") {
      this.message = "The split diff needs a Herdr build with set_scroll_top";
      return this.redraw();
    }
    this.splitDiff = !this.splitDiff;
    for (const document of this.documents.values()) {
      if (!document.diff) continue;
      document.diff.state.set_folding?.(!this.splitDiff);
      this.buildDiff(document);
    }
    this.message = this.splitDiff ? "Split diff" : "Stacked diff";
    this.redraw();
  }

  stepChange(step) {
    const diff = this.current?.diff;
    const kinds = diff?.kinds ?? [];
    const changed = (kind) => kind === "add" || kind === "del" || kind === "gap";
    const starts = kinds.flatMap((kind, i) => (changed(kind) && (i === 0 || !changed(kinds[i - 1])) ? [i] : []));
    if (!starts.length) {
      this.message = "No changes in this file";
      return this.redraw();
    }
    const text = diff.state.value();
    const line = positionOf(text, diff.state.selected_range().start).line;
    const target = step > 0 ? starts.find((start) => start > line) ?? starts[0] : starts.findLast((start) => start < line) ?? starts.at(-1);
    const offset = offsetOf(text, { line: target, character: 0 });
    diff.state.set_selected_range({ start: offset, end: offset });
    diff.state.focus();
    this.message = `Change ${starts.indexOf(target) + 1}/${starts.length}`;
    this.redraw();
  }

  queueDiffSync(document) {
    const diff = document.diff;
    if (!diff || diff.syncing) return;
    const seq = (diff.syncSeq ?? 0) + 1;
    diff.syncSeq = seq;
    diff.pendingSync = true;
    this.cx.timer.after(DIFF_SYNC_DELAY, () => { if (diff.syncSeq === seq) this.flushDiffSync(document); });
  }

  flushDiffSync(document) {
    if (!document.diff?.pendingSync) return;
    document.diff.pendingSync = false;
    this.syncFromDiff(document);
  }

  syncFromDiff(document) {
    const diff = document.diff;
    if (diff.syncing) return;
    const lines = diff.state.value().split("\n");
    const deleted = lines.filter(isVirtual);
    if (deleted.length !== diff.deleted.length || deleted.some((line, i) => line !== diff.deleted[i])) {
      if (diff.reverting) return;
      diff.reverting = true;
      this.cx.timer.after(0, () => {
        const at = Math.min(diff.state.selected_range().start, diff.value.length);
        const cursor = Math.max(0, diff.value.lastIndexOf("\n", Math.max(at - 1, 0)) + 1);
        diff.state.set_value(diff.value);
        diff.labelKey = diff.highlightKey = undefined;
        diff.state.set_selected_range({ start: cursor, end: cursor });
        diff.reverting = false;
        this.message = "Deleted lines and comments can't be edited";
        this.redraw();
      });
      return;
    }
    diff.value = lines.join("\n");
    const real = lines.filter((line) => !isVirtual(line)).join("\n");
    if (real !== document.state.value()) {
      document.syncing = true;
      patchValue(document.state, real);
      document.syncing = false;
      this.liveDiff(document);
    }
    this.labelDiff(document);
  }

  labelDiff(document) {
    const lines = document.diff.state.value().split("\n");
    const locked = lines.flatMap((text, i) => (isVirtual(text) ? [i] : []));
    const key = `${lines.length}:${locked.join(",")}`;
    if (document.diff.labelKey === key) return;
    document.diff.labelKey = key;
    let line = 0;
    document.diff.state.set_line_labels(lines.map((text) => (isVirtual(text) ? "" : String(++line))));
    document.diff.state.set_locked_lines(locked);
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
      if (isVirtual(lines[i])) continue;
      if (real === line) return i;
      real++;
    }
    return Math.max(lines.length - 1, 0);
  }

  realLineOf(document, diffLine) {
    return document.diff.state.value().split("\n").slice(0, diffLine).filter((line) => !isVirtual(line)).length;
  }





  paintComments(document) {
    const relative = this.relative(document.path);
    document.state.set_highlights("comments", this.comments
      .filter((comment) => comment.path === relative)
      .map((comment) => ({ range: lineRange(comment.start, comment.end), color: COMMENT_COLOR, style: "frame" })));
  }

  noteUnderCursor(document) {
    const diff = document?.diff;
    if (!diff?.notes) return null;
    const line = positionOf(diff.state.value(), diff.state.selected_range().start).line;
    return diff.notes.get(line) ?? null;
  }

  authorLabel(username) {
    return username === this.me ? "you" : `@${username}`;
  }

  threadFolded(thread) {
    return thread.resolved !== this.foldToggled.has(thread.id);
  }

  rebuildThreads(thread) {
    for (const document of this.documents.values()) if (document.diff) this.buildDiff(document);
    const diff = this.current?.diff;
    const at = diff?.notes && [...diff.notes].find(([, x]) => x.id === thread?.id)?.[0];
    if (at !== undefined && at !== null) {
      const offset = offsetOf(diff.state.value(), { line: at, character: 0 });
      diff.state.set_selected_range({ start: offset, end: offset });
    }
    this.redraw();
  }

  foldAtCursor() {
    const thread = this.noteUnderCursor(this.current);
    if (!thread) {
      this.message = "Put the cursor on an MR comment first";
      return this.redraw();
    }
    if (this.foldToggled.has(thread.id)) this.foldToggled.delete(thread.id); else this.foldToggled.add(thread.id);
    this.rebuildThreads(thread);
  }

  resolveAtCursor() {
    const thread = this.noteUnderCursor(this.current), review = this.review;
    if (!thread || !review) {
      this.message = "Put the cursor on an MR comment first";
      return this.redraw();
    }
    const resolved = !thread.resolved;
    thread.resolved = resolved;
    this.foldToggled.delete(thread.id);
    this.message = resolved ? "Thread resolved" : "Thread reopened";
    this.rebuildThreads(thread);
    resolveThread(this.root, review, thread.id, resolved).catch((error) => {
      thread.resolved = !resolved;
      this.message = `Couldn't ${resolved ? "resolve" : "reopen"} the thread: ${error?.message ?? error}`;
      this.rebuildThreads(thread);
    });
  }

  toggleThreads() {
    this.threadsShown = !this.threadsShown;
    for (const document of this.documents.values()) if (document.diff) this.buildDiff(document);
    this.message = this.threadsShown ? `${this.threads.length} MR thread${this.threads.length === 1 ? "" : "s"} shown in the code` : "MR comments hidden";
    this.redraw();
  }

  async loadThreads() {
    if (this.review?.kind !== "gitlab") {
      this.threads = [];
      return;
    }
    if (!this.me) {
      const me = await exec("glab", ["api", "user"], { cwd: this.root }).catch(() => null);
      try { this.me = me?.code === 0 ? JSON.parse(me.stdout).username : null; } catch { this.me = null; }
    }
    const threads = await reviewThreads(this.root, this.review).catch(() => null);
    if (!threads) return;
    this.threads = threads;
    for (const document of this.documents.values()) if (document.diff) this.buildDiff(document);
    this.redraw();
  }

  sendReply() {
    const reply = this.composer?.reply, review = this.review;
    const body = this.commentInput.value().trim();
    if (!reply) return;
    if (!body) {
      this.message = "The reply is empty";
      return this.redraw();
    }
    if (!review) {
      this.message = "No open MR for this branch anymore: the reply isn't posted";
      return this.redraw();
    }
    const note = { id: `pending-${Date.now()}`, author: this.me ?? "?", body };
    reply.notes = [...reply.notes, note];
    this.composer = null;
    for (const document of this.documents.values()) if (document.diff) this.buildDiff(document);
    this.focusActive(this.current);
    this.message = `Posting the reply on ${review.name}…`;
    this.redraw();
    replyThread(this.root, review, reply.id, body).then(() => {
      this.message = `Reply posted on ${review.name}`;
      this.redraw();
    }, (error) => {
      reply.notes = reply.notes.filter((x) => x !== note);
      for (const document of this.documents.values()) if (document.diff) this.buildDiff(document);
      this.message = `Reply not posted: ${error?.message ?? error}`;
      this.composer = { ...reply.composer, reply, error: String(error?.message ?? error) };
      this.commentInput.set_value(body);
      this.redraw();
    });
  }

  startComment() {
    const document = this.current;
    if (!document) return;
    const thread = this.noteUnderCursor(document);
    if (thread) {
      const at = { path: thread.path, start: thread.line, end: thread.line };
      this.composer = { ...at, code: "", reply: thread };
      thread.composer = at;
      this.commentInput.set_value("");
      this.commentInput.focus();
      this.redraw();
      return;
    }
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
    if (this.composer?.reply) return this.sendReply();
    const note = this.commentInput.value().trim();
    if (!this.composer || !note) return;
    const added = { id: `${Date.now()}-${this.comments.length}`, ...this.composer, note };
    this.comments.push(added);
    this.saveComments({ add: [added] });
    this.composer = null;
    for (const document of this.documents.values()) this.paintComments(document);
    this.focusActive(this.current);
    const onThread = this.threads.some((thread) => thread.path === this.comments.at(-1).path && thread.line >= this.comments.at(-1).start && thread.line <= this.comments.at(-1).end);
    this.message = onThread
      ? `Kept for ${this.agentName}, not posted on the MR: to reply to the thread, put the cursor on its comment lines, then ${this.hint("comment")}`
      : `${this.comments.length} comment${this.comments.length > 1 ? "s" : ""} ready · ${this.hint("send")} sends the review to ${this.agentName}`;
    this.redraw();
  }

  removeComment(id) {
    this.comments = this.comments.filter((comment) => comment.id !== id);
    this.saveComments({ remove: [id] });
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
      this.saveComments({ remove: sent.map((comment) => comment.id) });
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
      this.saveComments({ remove: sent.map((comment) => comment.id) });
      for (const document of this.documents.values()) this.paintComments(document);
      const count = `${sent.length} comment${sent.length > 1 ? "s" : ""}`;
      this.message = shown ? `Sent ${count}: ${this.agentName} answers on the right` : `Sent ${count}: ${this.agentName} is starting in the background`;
    } catch (error) {
      this.message = `Couldn't reach ${this.agentName}: ${error?.message ?? error}`;
    }
    this.redraw();
  }

  saveComments({ add = [], remove = [] }) {
    const root = this.root;
    if (!root) return;
    const write = (this.savingComments ?? Promise.resolve()).then(async () => {
      await exec("mkdir", ["-p", CACHE_DIR()]);
      const all = await readComments();
      const kept = (Array.isArray(all[root]) ? all[root] : []).filter((comment) => !remove.includes(comment.id) && !add.some((a) => a.id === comment.id));
      const comments = [...kept, ...add];
      if (comments.length) all[root] = comments; else delete all[root];
      await writeTextFile(COMMENTS_FILE(), JSON.stringify(all));
      setShared(COMMENTS_KEY, { ...(shared(COMMENTS_KEY) ?? {}), [root]: { at: Date.now(), by: this.instance } });
    });
    this.savingComments = write.catch((error) => {
      this.message = `Couldn't save the comments: ${error?.message ?? error}`;
      this.redraw();
    });
  }

  followComments() {
    const change = shared(COMMENTS_KEY)?.[this.root];
    if (!change || change.by === this.instance || change.at === this.commentsSeen) return;
    this.commentsSeen = change.at;
    this.cx.timer.after(0, () => this.reloadComments());
  }

  async reloadComments() {
    await this.savingComments;
    const saved = (await readComments())[this.root];
    this.comments = Array.isArray(saved) ? saved : [];
    for (const document of this.documents.values()) this.paintComments(document);
    this.redraw();
  }

  async loadRoot(folder) {
    const top = await exec("git", ["-C", folder, "rev-parse", "--show-toplevel"]);
    this.root = top.code === 0 ? top.stdout.trim() : folder;
    this.isRepo = top.code === 0;
    const saved = (await readComments())[this.root];
    if (Array.isArray(saved) && saved.length && !this.comments.length) {
      this.comments = saved;
      for (const document of this.documents.values()) this.paintComments(document);
      this.message = `${saved.length} comment${saved.length > 1 ? "s" : ""} kept from last time · ${this.hint("send")} sends them to ${this.agentName}`;
    }
    this.setFiles((await this.listFiles()) ?? []);
  }

  // The repository's files that exist on disk, or null when git can't list them. A file deleted from the working tree is
  // still in the index: left in the list, it can't be opened ("Cannot read").
  async listFiles() {
    const [listed, deleted] = await Promise.all([
      exec("git", ["-C", this.root, "ls-files", "--cached", "--others", "--exclude-standard"]),
      exec("git", ["-C", this.root, "ls-files", "--deleted"]).catch(() => null),
    ]);
    if (listed.code !== 0) return null;
    const gone = new Set(deleted?.code === 0 ? deleted.stdout.split("\n").filter(Boolean) : []);
    return listed.stdout.split("\n").filter((path) => path && !gone.has(path));
  }

  setFiles(files) {
    this.files = files;
    this.lowered = this.files.map((path) => path.toLowerCase());
    this.tree = buildTree(this.files);
    this.search = { query: "", candidates: [], results: [] };
    this.refreshSearch();
  }

  // A file created or deleted while the editor is open (by an agent, say) comes into the list or leaves it.
  async refreshFiles() {
    if (this.isRepo === false) return;
    const files = await this.listFiles();
    if (!files || (files.length === this.files.length && files.every((path, index) => path === this.files[index]))) return;
    this.setFiles(files);
    this.redraw();
  }

  refreshSearch() {
    const query = this.finder.value().trim().toLowerCase();
    const previous = this.search;
    // The highlighted result starts again at the top with a new query, and stays where it is when only the list of files changes.
    if (query !== this.finderQuery) {
      this.finderQuery = query;
      this.finderAt = 0;
    }
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
    this.finderAt = Math.min(this.finderAt, Math.max(this.search.results.length - 1, 0));
  }

  // ↑ and ↓ in the file finder: the keyboard stays in the field, so the query can still be edited.
  moveFinder(step) {
    const count = this.search.results.length;
    this.finderAt = (this.finderAt + step + count) % count;
    this.treeScroll.scroll_to_item(this.finderAt);
    this.redraw();
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
    this.commit = null;
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
      this.message = `${basename(path)} has unsaved changes: ${this.hint("save")} to save, ${this.hint("close")} or middle click again to close`;
      this.redraw();
      return;
    }
    const index = this.tabs.indexOf(path);
    this.tabs.splice(index, 1);
    this.back = this.back.filter((entry) => entry.path !== path);
    this.forward = this.forward.filter((entry) => entry.path !== path);
    this.documents.delete(path);
    this.flushChange(document);
    this.notifyServers(document, "textDocument/didClose", { textDocument: { uri: document.uri } });
    if (this.current === document) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.current = next ? this.documents.get(next) : null;
      if (this.current) {
        this.reveal(this.current);
        this.focusActive(this.current);
      }
    }
    if (this.typing?.document === document) this.typing = null;
    this.dropSplit(document);
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
    const items = await this.referenceItems(servers, document, position);
    if (this.references?.name !== name) return;
    this.references = { name, items, loading: false };
    this.redraw();
  }

  async symbolFrom(document, offset) {
    const servers = (await document.servers) ?? [];
    const text = document.state.value();
    const name = wordAt(text, offset);
    if (!name) return null;
    return {
      document, name, position: positionOf(text, offset),
      finders: servers.filter((server) => server.capabilities.referencesProvider),
      renamer: servers.find((server) => server.capabilities.renameProvider) ?? null,
    };
  }

  async pickSymbolAtCursor() {
    const document = this.current;
    if (!document) {
      this.symbol = { ...this.symbol, message: "Open a file and put the cursor on a symbol, or find one by name" };
      this.symbolInput.focus();
      this.redraw();
      return;
    }
    const symbol = await this.symbolFrom(document, this.realRange(document).start);
    if (!symbol) {
      this.symbol = { ...this.symbol, message: "No symbol under the cursor: find one by name" };
      this.symbolInput.focus();
      this.redraw();
      return;
    }
    this.useSymbol(symbol);
  }

  useSymbol(symbol) {
    this.symbol = { ...this.symbol, current: symbol, results: [], searching: false, message: "", selected: null, seq: this.symbol.seq + 1 };
    this.symbolInput.set_value(symbol.name);
    this.renameInput.set_value(symbol.name);
    this.renameInput.focus();
    this.loadSymbolUses();
  }

  async loadSymbolUses() {
    const symbol = this.symbol.current;
    if (!symbol) return;
    if (!symbol.finders.length) {
      this.symbol = { ...this.symbol, items: [], loading: false, message: "No language server finds the uses in this file" };
      this.redraw();
      return;
    }
    this.symbol = { ...this.symbol, loading: true };
    this.redraw();
    const items = await this.referenceItems(symbol.finders, symbol.document, symbol.position);
    if (this.symbol.current !== symbol) return;
    this.symbol = { ...this.symbol, items, loading: false };
    this.redraw();
  }

  queueSymbolSearch() {
    const query = this.symbolInput.value().trim();
    const seq = this.symbol.seq + 1;
    this.symbol.seq = seq;
    if (!query || query === this.symbol.current?.name) {
      this.symbol = { ...this.symbol, results: [], searching: false };
      this.redraw();
      return;
    }
    this.symbol.searching = true;
    this.redraw();
    this.cx.timer.after(GREP_DEBOUNCE, () => {
      if (seq === this.symbol.seq) this.searchSymbols(query, seq);
    });
  }

  async searchSymbols(query, seq) {
    const servers = (await Promise.all([...this.servers.values()].map((server) => Promise.resolve(server).catch(() => null))))
      .filter((server) => server?.capabilities?.workspaceSymbolProvider);
    if (!servers.length) {
      if (seq !== this.symbol.seq) return;
      this.symbol = { ...this.symbol, results: [], searching: false, message: "No language server is running: open a file of the project first" };
      this.redraw();
      return;
    }
    const answers = await Promise.all(servers.map((server) => server.client.request("workspace/symbol", { query }).catch(() => null)));
    if (seq !== this.symbol.seq) return;
    const root = `${this.root}/`;
    const results = answers.flatMap((answer) => (Array.isArray(answer) ? answer : []))
      .filter((found) => found?.location?.range && uriPath(String(found.location.uri)).startsWith(root))
      .slice(0, SYMBOL_LIMIT)
      .map((found) => ({ name: found.name, kind: SYMBOL_KINDS[found.kind] ?? "", container: found.containerName ?? "",
        path: uriPath(found.location.uri), line: found.location.range.start.line, character: found.location.range.start.character }));
    this.symbol = { ...this.symbol, results, searching: false, message: results.length ? "" : `No symbol named ${query}` };
    this.redraw();
  }

  async chooseSymbol(found) {
    await this.open(found.path, { line: found.line, character: found.character });
    const document = this.documents.get(found.path);
    if (!document) return;
    const text = document.state.value();
    const from = offsetOf(text, { line: found.line, character: found.character });
    const at = wordIndex(text, found.name, from);
    const symbol = await this.symbolFrom(document, at < 0 ? from : at);
    if (symbol) this.useSymbol(symbol);
  }

  async renameSymbol() {
    const symbol = this.symbol.current;
    const newName = this.renameInput.value().trim();
    if (!symbol || this.symbol.renaming || !newName || newName === symbol.name) return;
    if (!symbol.renamer) {
      this.symbol = { ...this.symbol, message: "No language server renames symbols in this file" };
      this.redraw();
      return;
    }
    this.symbol.renaming = true;
    this.redraw();
    const { document, renamer, position, name } = symbol;
    try {
      this.flushChange(document);
      const edit = await renamer.client.request("textDocument/rename", { textDocument: { uri: document.uri }, position, newName });
      const byPath = workspaceEdits(edit);
      if (!byPath.size) throw new Error(`${renamer.name} found nothing to rename`);
      let count = 0;
      for (const [path, edits] of byPath) {
        const open = this.documents.get(path);
        const before = open ? open.state.value() : await readTextFile(path).catch(() => null);
        if (before === null) continue;
        const text = applyTextEdits(before, edits);
        count += edits.length;
        if (text === before) continue;
        if (open) {
          const wasDirty = open.dirty;
          const { start } = open.state.selected_range();
          open.state.set_selected_range({ start: 0, end: before.length });
          open.state.replace(text);
          open.state.set_selected_range({ start: Math.min(start, text.length), end: Math.min(start, text.length) });
          if (!wasDirty) await this.saveDocument(open);
        } else {
          await writeTextFile(path, text, before);
        }
      }
      this.message = `Renamed ${name} to ${newName}: ${count} place${count === 1 ? "" : "s"} in ${byPath.size} file${byPath.size === 1 ? "" : "s"}`;
      const moved = { ...symbol, name: newName, position: shiftedPosition(position, byPath.get(document.path) ?? []) };
      this.symbol.renaming = false;
      this.useSymbol(moved);
      this.loadChanges();
    } catch (error) {
      this.symbol = { ...this.symbol, renaming: false, message: `Not renamed: ${error?.message ?? error}` };
    }
    this.redraw();
  }

  async referenceItems(servers, document, position) {
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
    return items.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  }

  searchTabs(t) {
    const tab = (id, label) => div().id(`search-tab-${id}`).flex_1().h(22).flex().items_center().justify_center().rounded(5).text_size(11.5).cursor_pointer()
      .text_color(this.searchTab === id ? t.foreground : t.dim)
      .when(this.searchTab === id, (el) => el.bg(t.selected))
      .when(this.searchTab !== id, (el) => el.hover((st) => st.bg(t.hover)))
      .on_mouse_down("left", stop).on_click(() => this.setSearchTab(id))
      .child(label);
    return h_flex().flex_none().mx(8).mt(8).p(2).gap(2).rounded(6).border_1().border_color(t.border)
      .child(tab("text", "Text"))
      .child(tab("symbol", "Symbol"));
  }

  symbolView(t) {
    const { current, items, loading, results, searching, renaming, message, selected } = this.symbol;
    const typed = this.symbolInput.value().trim();
    const browsing = Boolean(typed) && typed !== current?.name;
    const list = browsing
      ? this.rowList("symbol-results", results.map((found, i) => ({ kind: "found", key: `symbol-found-${i}`, entry: found })), (row) => this.row(t, row.key, 0, false)
        .child(div().flex_none().text_size(10).text_color(t.dim).child(row.entry.kind))
        .child(div().flex_none().child(row.entry.name))
        .child(div().min_w(0).truncate().text_size(10.5).text_color(t.dim)
          .child(`${row.entry.container ? `${row.entry.container} · ` : ""}${this.relative(row.entry.path)}:${row.entry.line + 1}`)), (row) => this.chooseSymbol(row.entry))
      : this.rowList("symbol-uses", this.symbolItems(items), (row) => (row.kind === "file" ? this.fileHeader(t, row) : this.row(t, row.key, 1, row.entry === selected)
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(row.entry.line + 1)))
        .child(div().flex_1().min_w(0).truncate().child(row.entry.text))), (row) => {
        if (row.kind !== "entry") return;
        this.symbol.selected = row.entry;
        this.goToReference(row.entry);
      });
    const files = new Set(items.map((item) => item.path)).size;
    const count = browsing ? (searching ? "Searching…" : `${results.length}${results.length >= SYMBOL_LIMIT ? "+" : ""} symbol${results.length === 1 ? "" : "s"}`)
      : current ? (loading ? "Looking for the uses…" : `${items.length} use${items.length === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}`) : "";
    const canRename = Boolean(current?.renamer) && !renaming && !browsing;
    return v_flex().flex_1().min_h(0).min_w(0)
      .child(v_flex().flex_none().px(10).py(8).gap(6).border_b(1).border_color(t.border)
        .child(Input.new(this.symbolInput).h(28).text_size(12.5))
        .when(Boolean(current) && !browsing, (el) => el
          .child(Input.new(this.renameInput).h(28).text_size(12.5))
          .child(h_flex().gap(6).items_center()
            .child(div().id("symbol-rename").px(8).h(22).flex().items_center().rounded(5).text_size(11.5).border_1().border_color(t.border)
              .when(canRename, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => this.renameSymbol()))
              .when(!canRename, (el) => el.text_color(t.dim))
              .on_mouse_down("left", stop).child(renaming ? "Renaming…" : "Rename"))
            .child(div().id("symbol-cursor").px(8).h(22).flex().items_center().rounded(5).text_size(11.5).border_1().border_color(t.border)
              .cursor_pointer().hover((st) => st.bg(t.hover)).on_mouse_down("left", stop).on_click(() => this.pickSymbolAtCursor())
              .child("At cursor"))
            .child(div().flex_1())
            .child(div().flex_none().text_size(10.5).text_color(t.dim).child(count))))
        .when(browsing || !current, (el) => el.child(h_flex().child(div().flex_1()).child(div().flex_none().text_size(10.5).text_color(t.dim).child(count))))
        .when(Boolean(message), (el) => el.child(div().text_size(11).text_color(t.dim).child(message))))
      .child(list);
  }

  symbolItems(items) {
    if (this.symbol.grouped?.from !== items) this.symbol.grouped = { from: items, items: groupByFile(items, "symbol") };
    return this.symbol.grouped.items;
  }

  async goToReference(item) {
    await this.open(item.path, null);
    const document = this.current;
    if (!document || document.path !== item.path) return;
    this.clearReferenceMark();
    const start = { line: item.line, character: item.character };
    document.state.set_highlights("reference", [{ range: { start: { line: item.line, character: 0 }, end: { line: item.line + 1, character: 0 } }, color: REFERENCE_COLOR }]);
    this.referenceMark = document;
    if (this.references) this.references.selected = item;
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
      .when(!loading && !items.length, (el) => el.child(this.note(t, "No use found")))
      .child(this.rowList("references-list", items.map((item, index) => ({ key: `reference-${index}`, entry: item })), (row) => this.row(t, row.key, 0, row.entry === this.references.selected)
        .child(div().flex_none().text_color(t.dim).child(`${this.relative(row.entry.path)}:${row.entry.line + 1}`))
        .child(div().flex_1().min_w(0).truncate().child(row.entry.text)), (row) => this.goToReference(row.entry)));
  }

  createDocument(path, text) {
    const extension = extensionOf(path);
    const language = languageOf(path, text);
    const state = ownHistoryEditor({ language: syntaxOf(basename(path), extension, language), value: text, font_family: MONO });
    const document = { path, uri: fileUri(path), state, saved: text, dirty: false, version: 1, diagnostics: [], diagnosticsBy: new Map(), language, preview: false, previewLine: null };
    this.resetHistory(document);
    this.trackTyping(document, state);
    state.on("change", () => {
      this.recordHistory(document);
      if (document.diff && !document.syncing) this.liveDiff(document);
      document.version += 1;
      const wasDirty = document.dirty;
      document.dirty = state.value() !== document.saved;
      document.closeArmed = false;
      this.queueChange(document);
      if (document.dirty !== wasDirty || document.preview) this.redraw();
    });
    document.servers = language ? this.attach(document) : Promise.resolve([]);
    this.paintChanges(document);
    this.paintComments(document);
    return document;
  }

  queueChange(document) {
    const version = document.version;
    document.pendingChange = version;
    this.cx.timer.after(CHANGE_DELAY, () => { if (document.pendingChange === version) this.flushChange(document); });
  }

  flushChange(document) {
    this.flushDiffSync(document);
    if (document.pendingChange === undefined) return;
    document.pendingChange = undefined;
    this.notifyServers(document, "textDocument/didChange", {
      textDocument: { uri: document.uri, version: document.version },
      contentChanges: [{ text: document.state.value() }],
    });
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
    const at = (request) => {
      this.flushChange(document);
      return { textDocument: { uri: document.uri }, position: request.position };
    };
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
    const definitionAnswer = firstAnswer("definitionProvider", "textDocument/definition");
    const completers = able("completionProvider");
    const options = {
      uri: document.uri,
      trigger_characters: [...new Set(completers.flatMap((server) => server.capabilities.completionProvider.triggerCharacters ?? []))],
      completion: completers.length
        ? async (request) => {
          const answers = await Promise.all(completers.map((server) => server.client
            .request("textDocument/completion", { ...at(request), context: contextFor(request.context, server) })
            .catch(() => null)));
          const items = answers.flatMap(completionItems);
          const snippets = items.some((item) => item.insertTextFormat === 2);
          const line = snippets ? document.state.value().split("\n")[request.position.line] ?? "" : "";
          const indent = /^[ \t]*/.exec(line)[0];
          return {
            isIncomplete: answers.some((answer) => answer?.isIncomplete),
            items: snippets ? items.map((item) => plainCompletion(item, indent, document.language.indent)) : items,
          };
        }
        : undefined,
      hover: able("hoverProvider").length ? (request) => this.hoverWithValue(document, firstAnswer("hoverProvider", "textDocument/hover"), firstAnswer("definitionProvider", "textDocument/definition"), request) : undefined,
      definition: definitionAnswer
        ? (request, cx) => (usesChord(this.pointerModifiers) ? null : definitionAnswer(request, cx))
        : undefined,
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
        : kind === "shellcheck"
          ? await exec("sh", ["-c", INSTALL_SHELLCHECK, "sh", SERVERS_DIR(), SHELLCHECK_VERSION], { timeout })
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
      const prepared = (await spec.prepare?.(this, { command, cwd, configured: Boolean(configured) })) ?? {};
      command = prepared.command ?? command;
      const settings = prepared.settings ?? {};
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
      await spec.connected?.(this, client);
      const capabilities = await client.initialize(this.root, (section) => lookup(settings, section), prepared.options ?? settings);
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
    this.flushDiffSync(document);
    const text = document.state.value();
    if (text === document.saved) return;
    try {
      await writeTextFile(document.path, text, document.saved);
      document.saved = text;
      document.dirty = false;
      this.flushChange(document);
      this.notifyServers(document, "textDocument/didSave", { textDocument: { uri: document.uri }, text });
      this.message = `Saved ${this.relative(document.path)}`;
      await this.fixOnSave(document);
      this.loadChanges();
    } catch (error) {
      this.message = `Not saved: ${error?.message ?? error}`;
    }
    this.redraw();
  }

  async fixers(path) {
    const extension = extensionOf(path);
    const configured = this.config.fixOnSave?.[extension];
    if (configured === false || this.config.fixOnSave === false) return [];
    if (Array.isArray(configured)) return configured.map((command) => ({ command: command.map((arg) => arg.replaceAll("{file}", path)), cwd: this.root }));
    const runnable = async (file) => (await exec("test", ["-x", file])).code === 0;
    if (extension === "py" || extension === "pyi") {
      const venv = await this.findVenv();
      const ruff = venv && (await runnable(`${venv}/bin/ruff`)) ? `${venv}/bin/ruff` : (await exec("sh", ["-c", "command -v ruff"])).stdout.trim();
      return ruff ? [{ command: [ruff, "check", "--fix", "--quiet", path], cwd: this.root }, { command: [ruff, "format", "--quiet", path], cwd: this.root }] : [];
    }
    if (["vue", "js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(extension)) {
      for (let folder = dirname(path); folder.startsWith(this.root); folder = dirname(folder)) {
        if (await runnable(`${folder}/node_modules/.bin/eslint`)) return [{ command: [`${folder}/node_modules/.bin/eslint`, "--fix", path], cwd: folder }];
        if (folder === this.root) break;
      }
    }
    return [];
  }

  async fixOnSave(document) {
    const steps = await this.fixers(document.path);
    if (!steps.length) return;
    const problems = [];
    for (const { command, cwd } of steps) {
      const r = await exec(command[0], command.slice(1), { cwd });
      const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
      if (r.code !== 0 && output) problems.push(`${basename(command[0])}: ${output.split("\n")[0]}`);
    }
    const fixed = await readTextFile(document.path);
    if (typeof fixed === "string" && fixed !== document.saved && this.documents.get(document.path) === document) {
      const selection = document.state.selected_range();
      document.saved = fixed;
      patchValue(document.state, fixed);
      const end = Math.min(selection.end, fixed.length);
      document.state.set_selected_range({ start: Math.min(selection.start, end), end });
    }
    if (problems.length) this.message = `Saved ${this.relative(document.path)} · ${problems[0]}`;
  }

  // The editor (the file's, or its diff) that has the keyboard, so a line edit never lands in another field.
  resetHistory(document) {
    document.history = { undo: [], redo: [], last: document.state.value(), at: 0, applying: false };
  }

  recordHistory(document) {
    const history = document.history;
    const text = document.state.value();
    if (history.applying || text === history.last) return;
    const now = Date.now();
    if (now - history.at > UNDO_GROUP_MS || !history.undo.length) {
      history.undo.push(history.last);
      if (history.undo.length > UNDO_DEPTH) history.undo.shift();
    }
    history.redo = [];
    history.at = now;
    history.last = text;
  }

  stepHistory(step) {
    const document = this.typing?.document;
    if (!document || this.documents.get(document.path) !== document || this.typing.state === document.split?.state) return false;
    if (document.diff) this.flushDiffSync(document);
    const history = document.history;
    const from = step < 0 ? history.undo : history.redo;
    if (!from.length) {
      this.message = step < 0 ? "Nothing to undo" : "Nothing to redo";
      this.redraw();
      return true;
    }
    const before = document.state.value();
    const text = from.pop();
    (step < 0 ? history.redo : history.undo).push(before);
    history.applying = true;
    patchValue(document.state, text);
    history.applying = false;
    history.last = text;
    history.at = 0;
    if (document.diff) this.buildDiff(document);
    const at = firstDifference(before, text) + Math.max(0, text.length - before.length);
    this.selectReal(document, { start: at, end: at });
    this.message = "";
    this.redraw();
    return true;
  }

  toggleFold() {
    const state = this.typing?.state;
    if (!state || typeof state.toggle_fold !== "function") return false;
    const text = state.value();
    const start = state.toggle_fold(positionOf(text, state.selected_range().start).line);
    if (start === null) {
      this.message = "No block to fold here";
    } else {
      const offset = offsetOf(text, { line: start, character: (text.split("\n")[start] ?? "").length });
      state.set_selected_range({ start: offset, end: offset });
      this.message = "";
    }
    this.redraw();
    return true;
  }

  trackTyping(document, state) {
    state.on("focus", () => { this.typing = { document, state }; });
    state.on("blur", () => { if (this.typing?.state === state) this.typing = null; });
  }

  // Delete, cut, move or duplicate the line (or lines) the cursor is on. False when the key is not for the editor to take.
  editLines(operation, cx) {
    const { document, state } = this.typing ?? {};
    if (!document || this.documents.get(document.path) !== document) return false;
    const text = state.value();
    const edit = operation(text, state.selected_range());
    if (edit === false) return false;
    if (!edit) return true;
    if (state === document.diff?.state && text.split("\n").slice(edit.first, edit.last + 1).some(isVirtual)) {
      this.message = "Deleted lines and comments can't be edited";
      this.redraw();
      return true;
    }
    if (edit.copy !== undefined) cx.write_to_clipboard(edit.copy);
    state.set_selected_range({ start: edit.from, end: edit.to });
    state.replace(edit.text);
    state.set_selected_range({ start: edit.start, end: edit.end });
    return true;
  }

  clipboard(kind, cx) {
    const { document, state } = this.typing ?? {};
    if (!document || this.documents.get(document.path) !== document) return false;
    const text = state.value();
    const { start, end } = state.selected_range();
    if (kind === "copy") {
      if (start === end) return false;
      cx.write_to_clipboard(text.slice(start, end));
      return true;
    }
    const pasted = kind === "paste" ? cx.read_from_clipboard() : "";
    if (pasted === undefined || (kind === "cut" && start === end)) return false;
    if (state === document.diff?.state && text.slice(text.lastIndexOf("\n", start - 1) + 1, end).split("\n").some(isVirtual)) {
      this.message = "Deleted lines and comments can't be edited";
      this.redraw();
      return true;
    }
    if (kind === "cut") cx.write_to_clipboard(text.slice(start, end));
    state.replace(pasted);
    return true;
  }

  onKey(e, cx) {
    const key = e.keystroke;
    const action = this.keymap.get(key);
    if (action) {
      if (action.run(this, cx) === false) return;
    } else if ((key === "down" || key === "up") && this.finderFocus && this.search.results.length) this.moveFinder(key === "down" ? 1 : -1);
    else if (key === "shift-enter" && this.findOpen) this.findStep(-1);
    else if (key === "escape" && this.references) this.closeReferences();
    else if (key === "escape" && this.commit) this.closeCommit();
    else if (key === "escape" && this.findOpen) this.closeFind();
    else if (key === "escape" && this.shortcutsShown) this.toggleShortcuts();
    else if (key === "escape" && this.composer) this.cancelComment();
    else if (key === "escape" && this.current) this.focusActive(this.current);
    else if (key === "escape" && props()?.overlay) closeOverlay(props().overlay);
    else return;
    cx.stop_propagation();
  }

  render() {
    this.followComments();
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
    const changed = this.shownChanges()?.files.length ?? 0;
    const head = h_flex().h(32).flex_none().px(6).gap(2).items_center().border_b(1).border_color(t.border)
      .child(this.modeButton(t, "files", "Files"))
      .child(this.modeButton(t, "changes", changed ? `Changes ${changed}` : "Changes"))
      .child(this.modeButton(t, "search", "Search"))
      .child(this.modeButton(t, "graph", "Graph"))
      .child(div().flex_1())
      .when(this.mode === "changes" || this.mode === "graph", (el) => el.child(div().id("changes-refresh").px(6).rounded(4).text_size(12).text_color(t.dim)
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click(() => this.loadChanges())
        .child(this.changesLoading || this.graphLoading ? "…" : "↻")));
    const side = v_flex().relative().w(this.sideWidth).flex_none().min_h(0).min_w(0).overflow_hidden().border_r(1).border_color(t.border)
      .child(div().id("side-resize").absolute().top(0).bottom(0).right(0).w(5).cursor_col_resize().hover((s) => s.bg(t.accent))
        .when(Boolean(this.resizing), (el) => el.bg(t.accent))
        .on_mouse_down("left", (e, cx) => this.startResize(e, cx)))
      .child(head);
    if (this.mode === "changes") return side.child(this.changesView(t, currentPath)).child(this.reviewPanel(t));
    if (this.mode === "search") return side.child(this.searchTabs(t)).child(this.searchTab === "symbol" ? this.symbolView(t) : this.grepView(t));
    if (this.mode === "graph") return side.child(this.graphView(t));
    return side
      .child(h_flex().h(40).flex_none().px(10).items_center().border_b(1).border_color(t.border)
        .child(Input.new(this.finder).flex_1().h(28).text_size(12.5)))
      .child(this.search.query && !this.search.results.length ? this.note(t, "No file matches") : this.search.query ? this.searchRows(t) : this.treeView(t, currentPath))
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
        if (mode === "graph" && !this.graph) this.loadGraph();
        this.redraw();
      })
      .child(label);
  }

  scopeButton(t, scope, label, count) {
    const active = this.scope === scope;
    return div().id(`scope-${scope}`).flex_1().h(22).flex().items_center().justify_center().rounded(5).text_size(11.5).cursor_pointer()
      .text_color(active ? t.foreground : t.dim)
      .when(active, (el) => el.bg(t.selected))
      .when(!active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_mouse_down("left", stop)
      .on_click(() => this.setScope(scope))
      .child(count == null ? label : `${label} ${count}`);
  }

  graphView(t) {
    if (!this.graph) return v_flex().flex_1().min_h(0).child(div().px(12).py(8).text_size(12).text_color(t.dim).child(this.graphLoading ? "Reading the history…" : "No history"));
    const graph = this.graph;
    const selected = this.commit?.sha;
    const keyOf = (index) => graph[index].sha ?? `line-${index}`;
    const render = (range) => graph.slice(range.start, range.end).map((entry) => {
      const lanes = h_flex().flex_none().font_family(MONO).text_size(11.5)
        .children(laneRuns(entry.graph).map(({ text, lane }) => div().text_color(LANE_COLORS[lane % LANE_COLORS.length]).child(text)));
      const row = h_flex().h(GRAPH_ROW).mx(4).px(6).gap(6).min_w(0).overflow_hidden().items_center().rounded(5).text_size(11.5).child(lanes);
      if (!entry.sha) return row;
      return row.cursor_pointer().hover((st) => st.bg(t.hover))
        .when(entry.sha === selected, (el) => el.bg(t.selected))
        .child(div().flex_none().font_family(MONO).text_size(10.5).text_color(t.dim).child(entry.short))
        .children(entry.refs.map((ref) => div().flex_none().px(4).rounded(3).text_size(10).bg(t.selected)
          .text_color(ref.startsWith("origin/") ? t.dim : CHANGE_COLORS.added).child(ref)))
        .child(div().flex_1().min_w(0).truncate().when(entry.head, (el) => el.font_semibold()).child(entry.subject));
    });
    return v_flex().flex_1().min_h(0).relative().py(4)
      .child(v_virtual_list("code-graph", graph.length, GRAPH_ROW, keyOf, render).size_full()
        .on_item_click((key) => {
          if (!key.startsWith("line-")) this.showCommit(key);
        }))
      .child(Scrollbar.vertical("code-graph").absolute().inset_0());
  }

  commitItems(commit) {
    const items = [];
    const rest = commit.message.split("\n").slice(1).join("\n").trim();
    if (rest) items.push({ kind: "message", text: rest, height: rest.split("\n").length * 17 + 16 });
    let shown = 0;
    commit.files.forEach((file, index) => {
      items.push({ kind: "file", file, index, height: 28 });
      if (file.collapsed || file.too_large || shown >= COMMIT_ROWS) {
        items.push({ kind: "note", text: file.collapsed ? "Binary file" : "Too large to show", height: 22 });
        return;
      }
      for (const row of file.rows) items.push({ kind: "row", row, height: DIFF_ROW });
      shown += file.rows.length;
    });
    if (!commit.files.length) items.push({ kind: "note", text: "No file changes", height: 30 });
    return items;
  }

  commitItem(t, item) {
    if (item.kind === "message") return div().px(12).py(8).text_size(12).text_color(t.dim).child(item.text);
    if (item.kind === "note") return div().h(item.height).px(12).flex().items_center().text_size(11.5).text_color(t.dim).child(item.text);
    if (item.kind === "file") {
      const { file } = item;
      const added = file.rows.filter((row) => row.kind === "add").length;
      const removed = file.rows.filter((row) => row.kind === "del").length;
      return h_flex().h(28).px(12).gap(8).items_center().border_y(1).border_color(t.border).bg(t.hover)
        .font_family(MONO).text_size(12).cursor_pointer()
        .child(iconElement(fileIcon(file.new_path), t.dim))
        .child(div().flex_1().min_w(0).truncate().child(file.renamed_file ? `${file.old_path} → ${file.new_path}` : file.new_path))
        .child(div().flex_none().text_size(10.5).text_color("#16a34a").child(added ? `+${added}` : ""))
        .child(div().flex_none().text_size(10.5).text_color("#dc2626").child(removed ? `−${removed}` : ""));
    }
    const { row } = item;
    const kind = row.kind;
    const number = (value) => div().flex_none().text_color(t.dim).child(kind === "hunk" ? "     " : String(value ?? "").padStart(5));
    return h_flex().h(DIFF_ROW).px(12).gap(10).min_w(0).items_center().font_family(MONO).text_size(12)
      .when(kind === "add", (el) => el.bg(DIFF_ADDED))
      .when(kind === "del", (el) => el.bg(DIFF_DELETED))
      .when(kind === "hunk", (el) => el.text_color(t.dim))
      .child(number(row.old))
      .child(number(row.new))
      .child(div().flex_none().text_color(kind === "add" ? CHANGE_COLORS.added : kind === "del" ? CHANGE_COLORS.deleted : t.dim)
        .child(kind === "add" ? "+" : kind === "del" ? "−" : " "))
      .child(div().min_w(0).truncate().child(row.text.replace(/\t/g, "  ") || " "));
  }

  commitPanel(t) {
    const commit = this.commit;
    const header = h_flex().h(34).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_family(MONO).text_size(12).text_color(t.dim).child(commit.sha.slice(0, 10)))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().child(commit.loading ? "Loading…" : commit.message.split("\n")[0]))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(commit.loading ? "" : `${commit.author} · ${commit.when}`))
      .child(div().id("close-commit").flex_none().w(20).h(20).flex().items_center().justify_center().rounded(4).text_size(12).text_color(t.dim)
        .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click(() => this.closeCommit())
        .child("×"));
    if (commit.loading) return v_flex().flex_1().min_w(0).min_h(0).child(header);
    commit.items ??= this.commitItems(commit);
    const items = commit.items;
    return v_flex().flex_1().min_w(0).min_h(0)
      .child(header)
      .child(v_flex().flex_1().min_h(0).relative()
        .child(v_virtual_list(`commit-${commit.sha}`, items.length, items.map((item) => item.height), (index) => String(index),
          (range) => items.slice(range.start, range.end).map((item) => this.commitItem(t, item))).size_full()
          .on_item_click((key) => {
            const item = items[Number(key)];
            if (item?.kind === "file") this.open(item.file.new_path, null);
          }))
        .child(Scrollbar.vertical(`commit-${commit.sha}`).absolute().inset_0()));
  }

  changesView(t, currentPath) {
    const changes = this.shownChanges();
    const section = (label) => div().px(12).pt(10).pb(4).text_size(11).font_semibold().text_color(t.dim).child(label);
    if (!changes) return v_flex().flex_1().min_h(0).child(this.note(t, this.changesLoading ? "Reading the branch…" : "No changes"));
    const filter = this.changesRegex();
    const rows = changes.files.flatMap((file, index) => (filter.regex && !filter.regex.keeps(file)
      ? [] : [{ key: `changed-${index}`, file, ...lineCounts(file) }]));
    return v_flex().flex_1().min_h(0)
      .child(h_flex().flex_none().mx(8).mt(8).p(2).gap(2).rounded(6).border_1().border_color(t.border)
        .child(this.scopeButton(t, "uncommitted", "Uncommitted", this.working?.files.length ?? 0))
        .child(this.scopeButton(t, "all", "All", this.changes?.files.length ?? 0)))
      .child(div().flex_none().px(12).pt(8).text_size(11.5).text_color(t.dim).font_family(MONO).truncate().child(`${changes.branch} → ${changes.base}`))
      .child(h_flex().flex_none().px(8).pt(8).child(Input.new(this.changesFilter).flex_1().h(26).text_size(12)))
      .when(Boolean(filter.error), (el) => el.child(div().flex_none().px(12).pt(4).text_size(11).text_color(CHANGE_COLORS.deleted).child(filter.error)))
      .child(div().flex_none().child(section(filter.regex ? `FILES · ${rows.length} of ${changes.files.length}` : `FILES · ${changes.files.length}`)))
      .child(this.rowList("code-changes", rows, (row) => this.row(t, row.key, 0, row.file.new_path === currentPath)
        .child(iconElement(fileIcon(row.file.new_path), t.dim))
        .child(h_flex().flex_1().min_w(0).gap(6).items_center()
          .child(div().min_w(0).truncate().child(basename(row.file.new_path)))
          .child(div().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(row.file.new_path.slice(0, -basename(row.file.new_path).length - 1))))
        .child(div().flex_none().text_size(10.5).text_color("#16a34a").child(row.added ? `+${row.added}` : ""))
        .child(div().flex_none().text_size(10.5).text_color("#dc2626").child(row.removed ? `−${row.removed}` : "")), (row) => this.open(row.file.new_path, null)));
  }

  // Every list that can grow with the project goes through here: only the rows on screen are built.
  // Rows carry no handlers (a virtual list refuses them); a click reaches `pick` with the row's item.
  rowList(id, items, draw, pick, scroll = null) {
    const byKey = new Map(items.map((item) => [item.key, item]));
    const sizes = items.some((item) => item.height) ? items.map((item) => item.height ?? LIST_ROW) : LIST_ROW;
    let list = v_virtual_list(id, items.length, sizes, (n) => items[n].key, (range) => items.slice(range.start, range.end).map(draw)).size_full()
      .on_item_click((key) => { const item = byKey.get(key); if (item) pick(item); });
    if (scroll) list = list.track_scroll(scroll);
    return v_flex().flex_1().min_h(0).relative().child(list).child(Scrollbar.vertical(id).absolute().inset_0());
  }

  changesRegex() {
    const source = this.changesFilter.value().trim();
    if (this.changesFilterCache?.source !== source) {
      const exclude = source.startsWith("!");
      const pattern = exclude ? source.slice(1) : source;
      let compiled = { source, regex: null, error: "" };
      if (pattern) {
        try {
          const regex = new RegExp(pattern, "i");
          compiled.regex = { keeps: (file) => regex.test(file.new_path) || regex.test(file.old_path ?? "") ? !exclude : exclude };
        } catch (error) {
          compiled.error = `Invalid regex: ${String(error?.message ?? error).split("\n")[0]}`;
        }
      }
      this.changesFilterCache = compiled;
    }
    return this.changesFilterCache;
  }

  row(t, id, depth, selected) {
    return h_flex().id(id).h(LIST_ROW).mx(4).min_w(0).overflow_hidden().pr(8).pl(6 + depth * 14).gap(6).items_center().rounded(5)
      .font_family(MONO).text_size(11.5).cursor_pointer().hover((s) => s.bg(t.hover))
      .when(selected, (el) => el.bg(t.selected));
  }

  fileHeader(t, item) {
    const relative = this.relative(item.path);
    return h_flex().id(item.key).h(FILE_HEADER_ROW).px(10).pt(6).gap(6).items_center().min_w(0).text_size(11.5)
      .child(iconElement(fileIcon(item.path), t.dim))
      .child(div().min_w(0).truncate().child(basename(item.path)))
      .child(div().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(relative.slice(0, -basename(item.path).length - 1)))
      .child(div().flex_1())
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(item.count)));
  }

  note(t, text) {
    return div().px(12).py(6).text_size(12).text_color(t.dim).child(text);
  }

  searchRows(t) {
    const rows = this.search.results.map((index, position) => ({ key: `match-${index}`, path: this.files[index], position }));
    return this.rowList("code-files", rows, (row) => this.row(t, row.key, 0, row.position === this.finderAt)
      .child(iconElement(fileIcon(row.path), t.dim))
      .child(div().min_w(0).truncate().child(row.path)), (row) => this.open(row.path, null), this.treeScroll);
  }

  treeView(t, currentPath) {
    const rows = this.treeRows().map((row) => ({ ...row, key: `${row.kind}:${row.path}` }));
    return this.rowList("code-files", rows, (row) => this.row(t, row.key, row.depth, row.path === currentPath)
      .child(div().w(12).flex_none().text_size(11).text_color(t.dim).child(row.kind === "folder" ? (row.open ? "▾" : "▸") : ""))
      .child(row.kind === "folder"
        ? iconElement([OWN_ICON(row.open ? "folder-open" : "folder"), null], t.dim)
        : iconElement(fileIcon(row.path), t.dim))
      .child(div().min_w(0).truncate()
        .when(this.changedPaths.has(row.path), (el) => el.text_color(this.changedPaths.get(row.path) === "added" ? "#16a34a" : "#d97706"))
        .child(row.name)), (row) => (row.kind === "folder" ? this.toggle(row.path) : this.open(row.path, null)), this.treeScroll);
  }

  editorPane(t) {
    if (this.commit) return this.commitPanel(t);
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
        .when(this.diffVisible(document), (el) => el.child(div().id("toggle-split").flex_none().px(5).rounded(4).cursor_pointer()
          .hover((st) => st.bg(t.hover).text_color(t.foreground))
          .when(this.splitDiff, (st) => st.bg(t.selected).text_color(t.foreground))
          .on_mouse_down("left", stop).on_click(() => this.toggleSplitDiff())
          .child(this.splitDiff ? `◫ split ${this.hint("splitDiff")}` : `☰ stacked ${this.hint("splitDiff")}`)))
        .when(isMarkdown(document.path), (el) => el.child(div().id("toggle-preview").flex_none().px(5).rounded(4).cursor_pointer()
          .hover((st) => st.bg(t.hover).text_color(t.foreground))
          .when(document.preview, (st) => st.bg(t.selected).text_color(t.foreground))
          .on_mouse_down("left", stop).on_click(() => this.togglePreview())
          .child("◧ preview")))
        .when(this.back.length > 0, (el) => el.child(div().child(`${this.hint("back")} back`)))
        .when(this.forward.length > 0, (el) => el.child(div().child(`${this.hint("forward")} forward`))))
      .when(this.findOpen, (el) => el.child(this.findBar(t)))
      .when(Boolean(this.composer), (el) => el.child(h_flex().flex_none().px(12).py(6).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_family(MONO).text_size(11).text_color(COMMENT_COLOR)
          .child(this.composer?.reply ? `reply to @${this.composer.reply.notes[0]?.author} · ${where(this.composer)}` : where(this.composer)))
        .child(Input.new(this.commentInput).flex_1().h(28).text_size(12.5))
        .when(Boolean(this.composer?.error), (el) => el.child(div().flex_shrink_1().min_w(0).max_w(420).truncate().text_size(11).text_color(CHANGE_COLORS.deleted).child(`not posted: ${this.composer.error}`)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(this.composer?.reply ? `⏎ post on ${this.review?.name ?? "the MR"} · Esc cancel` : "⏎ add · Esc cancel"))))
      .when(Boolean(this.peek) && !this.diffVisible(document), (el) => el.child(this.peekPanel(t)))
      .child(h_flex().flex_1().min_h(0).min_w(0).items_stretch()
        .child(div().flex().flex_col().flex_1().min_h(0).min_w(0)
          .on_mouse_up("right", () => this.cx.timer.after(0, () => this.findReferences()))
          .on_mouse_move((e) => { this.pointerModifiers = e.modifiers; })
          .on_mouse_down("left", (e) => { this.pointerModifiers = e.modifiers; })
          .on_mouse_up("left", (e) => {
            this.pointerModifiers = e.modifiers;
            if (usesChord(e.modifiers)) this.cx.timer.after(0, () => this.findReferences());
          })
          .child(this.splitDiff && this.diffVisible(document) && document.split
            ? h_flex().flex_1().min_h(0).min_w(0).items_stretch()
              .child(div().flex().flex_col().flex_1().min_w(0).border_r(1).border_color(t.border)
                .on_mouse_move(() => { this.splitLeader = "left"; })
                .child(Editor.new(document.split.state).flex_1().min_h(0)))
              .child(div().flex().flex_col().flex_1().min_w(0)
                .on_mouse_move(() => { this.splitLeader = "right"; })
                .on_key_down(() => { this.splitLeader = "right"; })
                .child(Editor.new(document.diff.state).flex_1().min_h(0)))
            : Editor.new(this.activeState(document)).flex_1().min_h(0)))
        .when(document.preview && isMarkdown(document.path), (el) => el.child(this.previewPane(t, document))))
      .when(Boolean(this.references), (el) => el.child(this.referencesPanel(t)));
  }

  togglePreview() {
    const document = this.current;
    if (!document || this.commit || !isMarkdown(document.path)) return;
    document.preview = !document.preview;
    this.focusActive(document);
    this.redraw();
  }

  // The Markdown of the file as the editor holds it (unsaved edits included), drawn beside the editor and redrawn on each change.
  // With a Herdr that has `scroll_to_line`, it keeps the line at the top of the editor at the top of the preview.
  previewPane(t, document) {
    const text = document.state.value();
    let view = null;
    if (text.trim()) {
      view = TextView.markdown(`preview:${document.path}`, text).selectable().scrollable()
        .on_link_click((url, cx) => this.openPreviewLink(document, url, cx));
      if (typeof view.scroll_to_line === "function" && document.previewLine != null) view = view.scroll_to_line(document.previewLine);
    }
    return v_flex().id("markdown-preview").flex_1().min_w(0).min_h(0).border_l(1).border_color(t.border).px(24).py(12)
      .child(div().size_full().max_w(880).child(view ?? div().text_color(t.dim).child("Nothing to preview")));
  }

  // The editor doesn't tell when it scrolls, so the line at its top is asked for while a preview is open.
  syncPreview() {
    const document = this.current;
    if (!document?.preview || this.diffVisible(document) || typeof document.state.first_visible_line !== "function") return;
    const line = document.state.first_visible_line();
    if (line == null || line === document.previewLine) return;
    document.previewLine = line;
    this.redraw();
  }

  openPreviewLink(document, url, cx) {
    if (/^https?:/i.test(url ?? "")) {
      cx.open_url(url);
      return;
    }
    const path = linkedPath(this.relative(document.path), url);
    if (path) this.open(path, null);
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
          .on_mouse_down("middle", stop)
          .on_mouse_up("middle", (_e, cx) => {
            cx.stop_propagation();
            this.closeTab(path);
          })
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
      .when(Boolean(this.changes?.branch), (el) => el.child(div().id("branch").flex_none().max_w(260).truncate().px(6).rounded(4).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.write_to_clipboard(this.changes.branch); this.message = `Copied ${this.changes.branch}`; this.redraw(); })
        .child(this.changes.branch === "HEAD" ? "⎇ detached HEAD" : `⎇ ${this.changes.branch}`)))
      .child(div().min_w(0).truncate().child(servers || "no language server"))
      .child(div().flex_1())
      .child(div().min_w(0).max_h(18).overflow_hidden().truncate().child(String(this.message ?? "").split("\n")[0]))
      .child(div().id("shortcuts-hint").px(6).rounded(4).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click(() => this.toggleShortcuts())
        .child(`Shortcuts ${this.hint("shortcuts")}`));
  }
}
