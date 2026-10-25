#!/bin/sh
# Compatibility wrapper: uses the Node.js/npm installation on your PATH.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec npm "$@"
