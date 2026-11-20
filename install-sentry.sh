#!/bin/sh
set -eu
. "$(dirname "$0")/lib/common.sh"
install_group sentry "sentry sentry-current sentry-open" "" "$@"
