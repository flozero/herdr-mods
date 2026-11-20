#!/bin/sh
set -eu
. "$(dirname "$0")/lib/common.sh"
install_group linear "linear linear-current linear-open" "" "$@"
