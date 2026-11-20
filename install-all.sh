#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
for script in "$here"/install-*.sh; do
  [ "$script" = "$here/install-all.sh" ] || "$script"
done
