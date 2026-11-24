here=$(cd "$(dirname "$0")" && pwd)
dest="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
skills="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"

copy_mod() {
  rsync -a --exclude=config.json --exclude=.cache --exclude=gpui-kit.d.ts --exclude=jsconfig.json "$here/mods/$1/" "$dest/mods/$1/"
}

install_skill() {
  src="$here/skills/$1/SKILL.md"
  dir="$skills/$1"
  new=$(cksum < "$src")
  if [ -f "$dir/SKILL.md" ]; then
    have=$(cksum < "$dir/SKILL.md")
    if [ "$have" = "$new" ]; then echo "$new" > "$dir/.herdr-mods"; return; fi
    if [ ! -f "$dir/.herdr-mods" ] || [ "$(cat "$dir/.herdr-mods")" != "$have" ]; then
      echo "  skill $1 kept as you edited it: $dir/SKILL.md (this repo's version: $src)"
      return
    fi
  fi
  mkdir -p "$dir"
  cp "$src" "$dir/SKILL.md"
  echo "$new" > "$dir/.herdr-mods"
  echo "  skill $1 -> $dir/SKILL.md"
}

merge_keys() {
  mkdir -p "$dest"
  python3 -I - "$dest/keys.json" "$1" <<'PY'
import json, os, sys

target, extra = sys.argv[1], sys.argv[2]
mine = json.load(open(target)) if os.path.exists(target) else {}
for section, bindings in json.load(open(extra)).items():
    have = mine.setdefault(section, {})
    for key, action in bindings.items():
        if key not in have:
            have[key] = action
            print(f"  key {section} {key} -> {action}")
        elif have[key] != action:
            print(f"  key {section} {key} kept as {have[key]} (wanted {action})")
with open(target + ".tmp", "w") as f:
    json.dump(mine, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(target + ".tmp", target)
PY
}

# retarget_keys <section> "<key> <from> <to>"...: a key that still has the action Herdr gives it (or none) gets <to>;
# one you changed is kept.
retarget_keys() {
  mkdir -p "$dest"
  python3 -I - "$dest/keys.json" "$@" <<'PY'
import json, os, sys

target, section, *moves = sys.argv[1:]
mine = json.load(open(target)) if os.path.exists(target) else {}
have = mine.setdefault(section, {})
for move in moves:
    key, old, new = move.split(" ")
    if have.get(key) in (None, old):
        if have.get(key) != new:
            print(f"  key {section} {key}: {have.get(key)} -> {new}")
        have[key] = new
    elif have[key] != new:
        print(f"  key {section} {key} kept as {have[key]} (wanted {new})")
with open(target + ".tmp", "w") as f:
    json.dump(mine, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(target + ".tmp", target)
PY
}

# drop_keys <section> "<key> <action>"...: a key an earlier version of these installers added is taken out when it still has
# that action; one you changed is kept.
drop_keys() {
  mkdir -p "$dest"
  python3 -I - "$dest/keys.json" "$@" <<'PY'
import json, os, sys

target, section, *drops = sys.argv[1:]
if not os.path.exists(target):
    sys.exit(0)
mine = json.load(open(target))
have = mine.get(section, {})
for drop in drops:
    key, action = drop.split(" ")
    if have.get(key) == action:
        del have[key]
        print(f"  key {section} {key} removed (was {action})")
    elif key in have:
        print(f"  key {section} {key} kept as {have[key]}")
with open(target + ".tmp", "w") as f:
    json.dump(mine, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(target + ".tmp", target)
PY
}

keep_webview_keys() {
  mkdir -p "$dest"
  python3 -I - "$dest/settings.json" "$@" <<'PY'
import json, os, sys

target, wanted = sys.argv[1], sys.argv[2:]
settings = json.load(open(target)) if os.path.exists(target) else {}
have = settings.get("webview_keys")
keys = list(have) if isinstance(have, list) else ["cmd-q", "cmd-shift-w", "ctrl-tab", "ctrl-shift-tab"]
for key in wanted:
    if key not in keys:
        keys.append(key)
        print(f"  webview_keys + {key}")
if have != keys:
    settings["webview_keys"] = keys
    with open(target + ".tmp", "w") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(target + ".tmp", target)
PY
}

install_group() {
  group=$1 mods=$2 group_skills=$3
  shift 3
  [ $# -eq 0 ] || { echo "usage: $0" >&2; exit 2; }
  echo "$group"
  for m in $mods; do
    target="$dest/mods/$m"
    if [ -L "$target" ]; then rm "$target"; fi
    mkdir -p "$target"
    copy_mod "$m"
    if [ -f "$target/config.example.json" ] && [ ! -f "$target/config.json" ]; then
      cp "$target/config.example.json" "$target/config.json"
      echo "  created mods/$m/config.json"
    fi
  done
  if [ "$(uname)" = Darwin ]; then merge_keys "$here/keys/$group.json"; fi
  if [ -f "$here/keys/$group.linux.json" ]; then merge_keys "$here/keys/$group.linux.json"
  elif [ "$(uname)" != Darwin ]; then merge_keys "$here/keys/$group.json"; fi
  for s in $group_skills; do install_skill "$s"; done
  if command -v herdr-app >/dev/null 2>&1; then
    for m in $mods; do herdr-app check "$dest/mods/$m" | sed 's/^/  /'; done
  fi
}
