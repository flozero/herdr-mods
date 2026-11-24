#!/bin/sh
set -eu
. "$(dirname "$0")/lib/common.sh"
[ $# -eq 0 ] || { echo "usage: $0" >&2; exit 2; }
echo skills
for s in "$here"/skills/*/; do install_skill "$(basename "$s")"; done
