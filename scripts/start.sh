#!/usr/bin/env bash
# Runs Daily Red locally with one command: prepares everything that's missing
# (toolchain, game source, vendor files), rebuilds the ROM incrementally and
# serves the site on localhost.
#
#   scripts/start.sh          # open http://localhost:8080
#   scripts/start.sh 3000     # open http://localhost:3000
#
# Re-running is safe: finished steps are skipped and the build is incremental
# (a few seconds when nothing changed). Your stats live in the browser for the
# address you use, so keep using the same port to keep your streaks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-8080}"

command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required (https://nodejs.org/)."; exit 1; }

if [ ! -x "$ROOT/.toolchain/arm-none-eabi/bin/arm-none-eabi-gcc" ] \
   && [ ! -x "$ROOT/.toolchain/arm-none-eabi/bin/arm-none-eabi-gcc.exe" ]; then
  "$ROOT/scripts/setup.sh"
else
  echo ">> Toolchain already installed, skipping setup.sh"
fi

if [ ! -e "$ROOT/pokefirered" ]; then
  "$ROOT/scripts/get-pokefirered.sh"
else
  echo ">> pokefirered/ already exists, skipping get-pokefirered.sh"
fi

VENDOR_OK=1
for f in nostalgist.js mgba_libretro.js mgba_libretro.wasm pixelify-sans.woff2; do
  [ -f "$ROOT/web/vendor/$f" ] || VENDOR_OK=0
done
if [ "$VENDOR_OK" = "1" ]; then
  echo ">> web/vendor/ already populated, skipping fetch-vendor.sh"
else
  "$ROOT/scripts/fetch-vendor.sh"
fi

"$ROOT/scripts/build-rom.sh"

echo
echo ">> Starting local server — open http://localhost:$PORT"
exec node "$ROOT/scripts/serve.mjs" "$PORT"
