#!/bin/sh
set -eu
. "$(dirname "$0")/lib/common.sh"
[ $# -eq 0 ] || { echo "usage: $0" >&2; exit 2; }
echo skills
for s in "$here"/skills/*/; do install_skill "$(basename "$s")"; done
# A skill this repo installed and no longer ships goes, unless it was edited since.
for dir in "$skills"/*/; do
  name=$(basename "$dir")
  [ -f "$dir/.herdr-mods" ] && [ ! -d "$here/skills/$name" ] || continue
  if [ "$(cksum < "$dir/SKILL.md")" = "$(cat "$dir/.herdr-mods")" ]; then
    rm -rf "$dir"
    echo "  skill $name removed (no longer in this repo)"
  else
    echo "  skill $name kept as you edited it: $dir/SKILL.md (no longer in this repo)"
  fi
done
# The compaction hooks (wired in ~/.claude/settings.json, see skills/README.md).
hooks="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks"
mkdir -p "$hooks"
for h in "$here"/hooks/*.sh; do cp "$h" "$hooks/$(basename "$h")"; echo "  hook $(basename "$h") -> $hooks/$(basename "$h")"; done
