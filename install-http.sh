#!/bin/sh
set -eu
. "$(dirname "$0")/lib/common.sh"
install_group http "http http-open" "" "$@"
