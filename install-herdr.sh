#!/bin/sh
# Herdr's own shortcuts on Linux: the macOS ones, with cmd = Super (see "Linux and Omarchy" in the README).
set -eu
. "$(dirname "$0")/lib/common.sh"
if [ "$(uname)" = Darwin ]; then echo "herdr: macOS has these keys already"; exit 0; fi
install_group herdr "" "" "$@"
# macOS: ctrl-1..9 select a space (and cmd-1..9 a tab); Linux's own default was ctrl-1..9 for tabs.
set --
for n in 1 2 3 4 5 6 7 8 9; do set -- "$@" "ctrl-$n tab.select:$n space.select:$n"; done
retarget_keys global "$@"
# cmd-1..9 used to select a tab here; Super + 1..0 are Omarchy's workspaces again, and tabs move with cmd-shift-[ and ].
set --
for n in 1 2 3 4 5 6 7 8 9; do set -- "$@" "cmd-$n tab.select:$n"; done
drop_keys global "$@"
# cmd-w used to close the tab here; Super + W is Omarchy's close window again, and Linux's own ctrl-shift-w closes a tab.
drop_keys global "cmd-w tab.close"
