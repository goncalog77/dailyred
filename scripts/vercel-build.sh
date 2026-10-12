#!/usr/bin/env bash
# Build command for Vercel (see vercel.json): recreates everything the static
# site needs inside web/ — toolchain, game source, vendor files, ROM build.
# A Vercel build starts from a fresh clone, so every step runs; locally the
# finished steps are skipped, exactly like scripts/start.sh (which then also
# serves the site — this script only builds).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The libpng step of setup.sh needs a native C compiler, which minimal build
# images sometimes lack. Best effort only: setup.sh reports clearly if there
# is still nothing to build with.
if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then
  (yum install -y -q gcc make 2>/dev/null || apt-get install -y -q gcc make 2>/dev/null || true) | tail -1 || true
fi

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
for f in nostalgist.js mgba_libretro.js mgba_libretro.wasm pixelify-sans.woff2 vercel-analytics.js; do
  [ -f "$ROOT/web/vendor/$f" ] || VENDOR_OK=0
done
if [ "$VENDOR_OK" = "1" ]; then
  echo ">> web/vendor/ already populated, skipping fetch-vendor.sh"
else
  "$ROOT/scripts/fetch-vendor.sh"
fi

"$ROOT/scripts/build-rom.sh"

echo
echo ">> Site ready in web/:"
ls -la "$ROOT/web/game" "$ROOT/web/vendor"
