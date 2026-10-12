#!/usr/bin/env bash
# Deprecated alias: scripts/setup.sh does the same thing and now supports
# macOS, Linux and Windows. Kept so old instructions keep working.
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/setup.sh" "$@"
