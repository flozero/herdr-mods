#!/bin/sh
set -eu
. "$(dirname "$0")/lib/common.sh"
install_group gitlab-review "gitlab-review gitlab-review-open" "" "$@"
