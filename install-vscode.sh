#!/bin/sh
set -eu
. "$(dirname "$0")/lib/common.sh"
install_group vscode "vscode vscode-open" "" "$@"
if [ "$(uname)" = Darwin ]; then keep_webview_keys cmd-alt-e cmd-e; fi
