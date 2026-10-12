#!/usr/bin/env bash
# Builds the modified FireRed ROM with the project-local toolchain
# (see scripts/setup.sh; on Windows run from Git Bash or WSL2) and puts a
# gzipped copy in web/game/ for the website.
#
#   scripts/build-rom.sh            # normal build
#   scripts/build-rom.sh clean      # any extra args are passed to make
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="$ROOT/.toolchain"
GAME="$ROOT/pokefirered"

if [ ! -x "$TC/arm-none-eabi/bin/arm-none-eabi-gcc" ] && [ ! -x "$TC/arm-none-eabi/bin/arm-none-eabi-gcc.exe" ]; then
  echo "Toolchain missing. Run scripts/setup.sh first."; exit 1
fi

# gbagfx asks pkg-config for libpng; clang also honours these variables,
# which lets it find our static libpng without pkg-config/Homebrew.
export CPATH="$TC/libpng/include${CPATH:+:$CPATH}"
export LIBRARY_PATH="$TC/libpng/lib${LIBRARY_PATH:+:$LIBRARY_PATH}"
# A no-op pkg-config so the tool Makefiles don't print "command not found".
export PATH="$ROOT/scripts/shims:$PATH"

# Portable CPU count: Windows' NUMBER_OF_PROCESSORS (inherited by Git Bash),
# nproc (Linux/macOS with coreutils), sysctl (macOS), else a fallback.
if [ -n "${NUMBER_OF_PROCESSORS:-}" ]; then
  JOBS="$NUMBER_OF_PROCESSORS"
elif command -v nproc >/dev/null 2>&1; then
  JOBS="$(nproc)"
else
  JOBS="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
fi

if [ "$#" -gt 0 ]; then
  make -C "$GAME" -j"$JOBS" TOOLCHAIN="$TC/arm-none-eabi" MODERN=1 "$@"
  exit 0
fi

make -C "$GAME" -j"$JOBS" TOOLCHAIN="$TC/arm-none-eabi" MODERN=1

ROM="$GAME/pokefirered_modern.gba"
# The website downloads a gzipped copy (16 MB -> ~5.5 MB, mostly 0xFF padding)
# and unpacks it in the browser, so it stays small on any static host. The
# file carries a content hash so repeat visits can cache it forever: the site
# reads the current name from manifest.json (fetched fresh), and an unchanged
# name means the cached ROM is still current.
mkdir -p "$ROOT/web/game"
rm -f "$ROOT"/web/game/dailyred.*.gba.gz
gzip -9 -n -c "$ROM" > "$ROOT/web/game/dailyred.gba.gz"
if command -v sha256sum >/dev/null 2>&1; then
  HASH="$(sha256sum "$ROOT/web/game/dailyred.gba.gz" | awk '{print $1}')"
else
  HASH="$(shasum -a 256 "$ROOT/web/game/dailyred.gba.gz" | awk '{print $1}')"
fi
HASH="$(printf '%s' "$HASH" | cut -c1-12)"
mv "$ROOT/web/game/dailyred.gba.gz" "$ROOT/web/game/dailyred.$HASH.gba.gz"
printf '{"rom": "dailyred.%s.gba.gz"}\n' "$HASH" > "$ROOT/web/game/manifest.json"
# RED's battle sprite for the site's title card (from the decomp, like the ROM).
cp "$GAME/graphics/trainers/front_pics/red_front_pic.png" "$ROOT/web/game/red.png"
echo
echo "Built $ROM"
echo "Website copy: web/game/dailyred.$HASH.gba.gz ($(wc -c < "$ROOT/web/game/dailyred.$HASH.gba.gz" | tr -d ' ') bytes)"
