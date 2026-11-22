#!/bin/sh
set -eu
. "$(dirname "$0")/lib/common.sh"
install_group code "code code-open" "" "$@"
