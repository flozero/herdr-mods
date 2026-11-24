#!/bin/sh
# Optional, Omarchy only: frees the Super chords Herdr's mods and its macOS keymap use (bindings.lua here), in
# your ~/.config/hypr/bindings.lua, between two marker lines. Run it again to update the block; --remove takes it out.
# It keeps a backup next to the file, reloads Hyprland, and puts the backup back if Hyprland reports an error.
# Not part of install-all.sh: it changes your Omarchy shortcuts.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dir="${HYPR_DIR:-$HOME/.config/hypr}"
file="$dir/bindings.lua"
mode=add reload=1
for arg in "$@"; do
  case $arg in
    --remove) mode=remove ;;
    --no-reload) reload=0 ;;
    *) echo "usage: $0 [--remove] [--no-reload]" >&2; exit 2 ;;
  esac
done
[ -f "$file" ] || { echo "$file not found: this is for Omarchy's Hyprland (Lua) configuration" >&2; exit 1; }

result=$(python3 -I - "$file" "$here/bindings.lua" "$mode" <<'PY'
import os, re, shutil, sys, time

file, body_file, mode = sys.argv[1:]
BEGIN = "-- BEGIN HERDR-MODS (managed by herdr-mods/omarchy/install.sh; run it with --remove to take this out)"
END = "-- END HERDR-MODS"
old = open(file).read()
block = re.compile(r"^-- BEGIN HERDR-MODS.*?^-- END HERDR-MODS\n?", re.S | re.M)
new = block.sub("", old)
if mode == "add":
    body = open(body_file).read().rstrip("\n")
    new = new.rstrip("\n") + "\n\n" + BEGIN + "\n" + body + "\n" + END + "\n"
elif new != old:
    new = new.rstrip("\n") + "\n"
if new == old:
    print("unchanged")
    sys.exit(0)
backup = f"{file}.bak.{time.strftime('%Y%m%d-%H%M%S')}-before-herdr-mods"
n = 1
while os.path.exists(backup):
    n += 1
    backup = f"{file}.bak.{time.strftime('%Y%m%d-%H%M%S')}-before-herdr-mods.{n}"
shutil.copy2(file, backup)
with open(file + ".tmp", "w") as f:
    f.write(new)
os.replace(file + ".tmp", file)
print("changed " + backup)
PY
)
case $result in
  unchanged) echo "omarchy: $file is already up to date" ;;
  changed\ *)
    backup=${result#changed }
    echo "omarchy: $file updated (backup: $backup)"
    if [ "$reload" = 1 ] && command -v hyprctl >/dev/null 2>&1; then
      hyprctl reload >/dev/null 2>&1 || true
      sleep 1
      errors=$(hyprctl configerrors 2>&1 | sed '/^$/d' || true)
      if [ -n "$errors" ]; then
        echo "omarchy: Hyprland reports errors, putting the backup back:" >&2
        echo "$errors" >&2
        cp "$backup" "$file"
        hyprctl reload >/dev/null 2>&1 || true
        exit 1
      fi
      echo "omarchy: Hyprland reloaded, no errors"
    else
      echo "omarchy: not reloaded; run hyprctl reload"
    fi ;;
esac
