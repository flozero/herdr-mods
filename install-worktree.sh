#!/bin/sh
set -eu
. "$(dirname "$0")/lib/common.sh"
install_group worktree "patcher worktree-sync worktree-new worktree-open" "" "$@"
