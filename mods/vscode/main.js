import { View, div, webview } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, props, focused, exec, home, appHome, readTextFile, writeTextFile } from "herdr";

const PORT = 8765;
const VERSION = "4.145.2";
const DIR = () => `${home()}/.cache/herdr-vscode`;
const SETTINGS = {
  "chat.disableAIFeatures": true,
  "chat.commandCenter.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "window.commandCenter": false,
  "workbench.layoutControl.enabled": false,
  "window.menuBarVisibility": "compact",
  "workbench.activity.showAccounts": false,
  "workbench.startupEditor": "none",
  "python.languageServer": "None",
  "python.useEnvironmentsExtension": false,
  "files.watcherExclude": {
    "**/.git/objects/**": true,
    "**/node_modules/**": true,
    "**/.pnpm-store/**": true,
    "**/.venv/**": true,
    "**/venv/**": true,
    "**/__pycache__/**": true,
    "**/.pants.d/**": true,
    "**/.ruff_cache/**": true,
    "**/.pytest_cache/**": true,
    "**/.cache/**": true,
    "**/dist/**": true,
    "**/target/**": true,
  },
  "search.exclude": {
    "**/.pnpm-store": true,
    "**/.venv": true,
    "**/venv": true,
    "**/.pants.d": true,
    "**/.ruff_cache": true,
    "**/.cache": true,
    "**/dist": true,
    "**/target": true,
  },
  "workbench.tips.enabled": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "workbench.enableExperiments": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
};
const START = `
dir="$1"; port="$2"; version="$3"
bin="$dir/code-server-$version-macos-arm64/bin/code-server"
curl -fsS -o /dev/null "http://127.0.0.1:$port/healthz" 2>/dev/null && exit 0
if [ ! -x "$bin" ]; then
  curl -fsSL "https://github.com/coder/code-server/releases/download/v$version/code-server-$version-macos-arm64.tar.gz" | tar xz -C "$dir" || exit 1
fi
nohup "$bin" --bind-addr "127.0.0.1:$port" --auth none --user-data-dir "$dir/data" --extensions-dir "$dir/extensions" \\
  --disable-telemetry --disable-update-check --disable-workspace-trust --disable-getting-started-override \\
  </dev/null >"$dir/log" 2>&1 &
curl -fsS -o /dev/null --retry 60 --retry-connrefused --retry-delay 1 "http://127.0.0.1:$port/healthz" || { tail -5 "$dir/log" >&2; exit 1; }
`;

const SYNC = `
dir="$1"; version="$2"; review="$3"
shift 3
bin="$dir/code-server-$version-macos-arm64/bin/code-server"
reviewed=$(sed -n 's/.*"version": "\\(.*\\)".*/\\1/p' "$review/package.json" | head -1)
wanted=$(printf '%s\\n' "$version" "review@$reviewed" "$@" | tr A-Z a-z)
[ "$wanted" = "$(cat "$dir/synced" 2>/dev/null)" ] && exit 0
if ! "$bin" --extensions-dir "$dir/extensions" --list-extensions --show-versions 2>/dev/null | grep -qx "herdr.herdr-review@$reviewed"; then
  tmp=$(mktemp -d)
  mkdir "$tmp/extension"
  cp "$review/package.json" "$review/extension.js" "$tmp/extension/"
  cp "$review/extension.vsixmanifest" "$review/[Content_Types].xml" "$tmp/"
  (cd "$tmp" && zip -qr review.vsix "[Content_Types].xml" extension.vsixmanifest extension) &&
    "$bin" --user-data-dir "$dir/data" --extensions-dir "$dir/extensions" --install-extension "$tmp/review.vsix" --force >>"$dir/log" 2>&1
  rm -rf "$tmp"
fi
installed=$("$bin" --extensions-dir "$dir/extensions" --list-extensions 2>/dev/null | tr A-Z a-z)
for id in "$@"; do
  lower=$(printf %s "$id" | tr A-Z a-z)
  printf '%s\\n' "$installed" | grep -qx "$lower" || "$bin" --user-data-dir "$dir/data" --extensions-dir "$dir/extensions" --install-extension "$id" >>"$dir/log" 2>&1
done
if ls -d "$dir"/extensions/ms-python.python-* >/dev/null 2>&1; then
  if [ ! -x "$dir/pet/bin/pet" ] && command -v cargo >/dev/null 2>&1; then
    cargo install --locked --git https://github.com/microsoft/python-environment-tools pet --root "$dir/pet" >>"$dir/log" 2>&1
  fi
  for ext in "$dir"/extensions/ms-python.python-* "$dir"/extensions/ms-python.vscode-python-envs-*; do
    [ -d "$ext" ] && [ -x "$dir/pet/bin/pet" ] && [ ! -x "$ext/python-env-tools/bin/pet" ] && mkdir -p "$ext/python-env-tools/bin" && cp "$dir/pet/bin/pet" "$ext/python-env-tools/bin/pet"
  done
fi
printf '%s' "$wanted" >"$dir/synced"
`;

const readJson = async (path) => {
  const text = await readTextFile(path).catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
};

async function extensions(folder) {
  const mine = (await readJson(`${appHome()}/mods/vscode/config.json`))?.extensions;
  const project = (await readJson(`${folder}/.vscode/extensions.json`))?.recommendations;
  const ids = [...(Array.isArray(mine) ? mine : []), ...(Array.isArray(project) ? project : [])].map(String);
  return [...new Map(ids.map((id) => [id.toLowerCase(), id])).values()];
}

async function writeSettings() {
  const path = `${DIR()}/data/User/settings.json`;
  const current = await readTextFile(path).catch(() => null);
  const settings = current === null ? { ...SETTINGS } : await readJson(path);
  if (!settings) return;
  const config = (await readJson(`${appHome()}/mods/vscode/config.json`)) ?? {};
  if (config.python) settings["python.defaultInterpreterPath"] = String(config.python);
  if (Array.isArray(config.agent) && config.agent.length) settings["herdrReview.agent"] = config.agent.map(String);
  if (config.settings && typeof config.settings === "object") Object.assign(settings, config.settings);
  const text = JSON.stringify(settings, null, 2) + "\n";
  if (text === current) return;
  await exec("mkdir", ["-p", `${DIR()}/data/User`]);
  await writeTextFile(path, text, current);
}

export default class VsCode extends View {
  init(_props, cx) {
    this.folder = props()?.folder ?? focused()?.cwd ?? home();
    this.url = null;
    this.error = null;
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", DIR()]);
      await writeSettings();
      const started = await exec("sh", ["-c", START, "sh", DIR(), String(PORT), VERSION], { timeout: 300000 }).catch((e) => ({ code: 1, stderr: String(e) }));
      if (started.code === 0) this.url = `http://127.0.0.1:${PORT}/?folder=${encodeURIComponent(this.folder)}`;
      else this.error = started.stderr.trim() || "VS Code did not start";
      cx.notify();
      await exec("sh", ["-c", SYNC, "sh", DIR(), VERSION, `${appHome()}/mods/vscode/herdr-review`, ...(await extensions(this.folder))], { timeout: 600000 }).catch(() => null);
    });
  }

  render() {
    const t = theme();
    if (this.url) return webview(this.url).id("vscode").size_full();
    return v_flex().size_full().items_center().justify_center().bg(t.background).text_color(t.dim)
      .child(div().child(this.error ?? "Starting VS Code…"));
  }
}
