#!/usr/bin/env bash
# Installs everything needed to build the Daily Red ROM into ./.toolchain
# (no sudo, nothing written outside this project):
#
#   - xPack GNU Arm Embedded GCC (arm-none-eabi-gcc + binutils + newlib),
#     used by pokefirered's `modern` build target via TOOLCHAIN=...
#     (Arm's own macOS x86_64 tarballs link cc1 against Homebrew's zstd and
#     crash without it; the xPack builds are self-contained.)
#   - libpng (static), needed by pokefirered/tools/gbagfx
#
# Works on macOS, Linux and Windows. On Windows run this from Git Bash
# (ships with Git for Windows) or WSL2, and have a native C compiler
# available (e.g. MSYS2's `pacman -S base-devel`, or Visual Studio Build Tools).
#
# Re-running is safe: finished steps are skipped.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="$ROOT/.toolchain"
mkdir -p "$TC/downloads"

GCC_VER="14.2.1-1.1"
LIBPNG_VER="1.6.44"

# --- Platform detection -------------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux) PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="win32" ;;
  *) echo "Unsupported OS: $OS ($(uname -a)). Daily Red builds on macOS, Linux and Windows (Git Bash/WSL)."; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) BITS="x64" ;;
  arm64|aarch64) BITS="arm64" ;;
  armv7*|armv6*) BITS="arm" ;; # 32-bit ARM Linux only
  *) echo "Unsupported CPU: $ARCH"; exit 1 ;;
esac

if [ "$PLATFORM" = "win32" ]; then
  if [ "$BITS" != "x64" ]; then
    echo "Only 64-bit Windows (x86_64) is supported (got $ARCH)."; exit 1
  fi
  GCC_HOST="win32-x64"
  ARCHIVE_EXT="zip"
elif [ "$PLATFORM" = "linux" ] && [ "$BITS" = "arm" ]; then
  GCC_HOST="linux-arm"
  ARCHIVE_EXT="tar.gz"
else
  GCC_HOST="$PLATFORM-$BITS"
  ARCHIVE_EXT="tar.gz"
fi

# --- Prerequisite checks ------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1. $2"; exit 1; }; }

need curl "Install curl for your OS first."
if [ "$ARCHIVE_EXT" = "zip" ]; then
  command -v unzip >/dev/null 2>&1 || need python3 "Install 'unzip' or Python 3 to unpack the Windows toolchain."
else
  need tar "Install tar for your OS first."
fi

if [ "$PLATFORM" = "darwin" ]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    echo "Xcode Command Line Tools are required. Run: xcode-select --install"
    exit 1
  fi
fi

# A native C compiler + archiver, for building the static libpng below.
# (This is the host compiler, not the ARM cross-compiler we download.)
NATIVE_CC="${CC:-}"
if [ -z "$NATIVE_CC" ]; then
  for candidate in cc gcc clang; do
    if command -v "$candidate" >/dev/null 2>&1; then NATIVE_CC="$candidate"; break; fi
  done
fi
if [ -z "$NATIVE_CC" ]; then
  case "$PLATFORM" in
    darwin) echo "No C compiler found. Install the Xcode Command Line Tools: xcode-select --install" ;;
    linux) echo "No C compiler found. Install one, e.g.: sudo apt install build-essential  # Debian/Ubuntu"; echo "  or: sudo dnf install gcc make  # Fedora  /  sudo pacman -S base-devel  # Arch" ;;
    win32) echo "No native C compiler found. Either install MSYS2 (pacman -S base-devel) and re-run from its bash,"; echo "  or install Visual Studio Build Tools, or build inside WSL2 instead." ;;
  esac
  exit 1
fi
if ! command -v ar >/dev/null 2>&1; then
  echo "Missing required tool: ar (binutils). Install your OS's C toolchain package (see above)."
  exit 1
fi

# Portable SHA-256 of a file (sha256sum on Linux/Windows Git Bash, shasum on macOS).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "No SHA-256 tool found (need sha256sum or shasum)." >&2
    return 1
  fi
}

extract_archive() { # file destdir
  if [ "$ARCHIVE_EXT" = "zip" ]; then
    if command -v unzip >/dev/null 2>&1; then
      unzip -q -o "$1" -d "$2"
    else
      python3 - "$1" "$2" <<'EOF'
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
EOF
    fi
  else
    tar -xzf "$1" -C "$2"
  fi
}

# The cross-compiler binary, with Windows' .exe suffix handled.
toolchain_gcc() {
  if [ -x "$TC/arm-none-eabi/bin/arm-none-eabi-gcc" ]; then
    echo "$TC/arm-none-eabi/bin/arm-none-eabi-gcc"
  elif [ -x "$TC/arm-none-eabi/bin/arm-none-eabi-gcc.exe" ]; then
    echo "$TC/arm-none-eabi/bin/arm-none-eabi-gcc.exe"
  else
    return 1
  fi
}

# --- arm-none-eabi GCC --------------------------------------------------------
GCC_NAME="xpack-arm-none-eabi-gcc-$GCC_VER"
if ! toolchain_gcc >/dev/null 2>&1; then
  tarball="$GCC_NAME-$GCC_HOST.$ARCHIVE_EXT"
  url="https://github.com/xpack-dev-tools/arm-none-eabi-gcc-xpack/releases/download/v$GCC_VER/$tarball"
  echo ">> Downloading $tarball"
  curl -fL --retry 3 -o "$TC/downloads/$tarball" "$url"
  curl -fsSL -o "$TC/downloads/$tarball.sha" "$url.sha"
  expected="$(awk '{print $1}' "$TC/downloads/$tarball.sha")"
  actual="$(sha256_of "$TC/downloads/$tarball")"
  [ "$expected" = "$actual" ] || { echo "Checksum mismatch for $tarball"; exit 1; }
  echo ">> Checksum OK, extracting"
  extract_archive "$TC/downloads/$tarball" "$TC"
  # The archive's top-level dir is $GCC_NAME on every platform; fall back to
  # the host-suffixed name in case upstream ever changes the layout.
  srcdir="$TC/$GCC_NAME"
  [ -d "$srcdir" ] || srcdir="$TC/$GCC_NAME-$GCC_HOST"
  # Replace any previous toolchain dir/symlink. Plain `ln -s` fails on Windows
  # without Developer Mode, so fall back to a copy there.
  if [ -L "$TC/arm-none-eabi" ]; then
    rm -f "$TC/arm-none-eabi"
  elif [ -e "$TC/arm-none-eabi" ]; then
    rm -rf "$TC/arm-none-eabi"
  fi
  if ln -s "$srcdir" "$TC/arm-none-eabi" 2>/dev/null; then
    :
  else
    echo ">> Symlinks unavailable, copying instead"
    rm -rf "$TC/arm-none-eabi"
    cp -r "$srcdir" "$TC/arm-none-eabi"
  fi
  rm -f "$TC/downloads/$tarball"
fi
GCC_BIN="$(toolchain_gcc)" || { echo "Toolchain install failed."; exit 1; }
"$GCC_BIN" --version | head -1
# Fail early if the compiler can't actually run (e.g. missing libraries).
echo 'int f(void){return 0;}' | "$GCC_BIN" -x c -c -o /dev/null -

# --- libpng (static, built with the native compiler) --------------------------
if [ ! -f "$TC/libpng/lib/libpng.a" ]; then
  echo ">> Building libpng $LIBPNG_VER with $NATIVE_CC"
  src="$TC/downloads/libpng-$LIBPNG_VER"
  rm -rf "$src"
  curl -fL --retry 3 -o "$src.tar.gz" \
    "https://github.com/pnggroup/libpng/archive/refs/tags/v$LIBPNG_VER.tar.gz"
  tar -xzf "$src.tar.gz" -C "$TC/downloads"
  cp "$src/scripts/pnglibconf.h.prebuilt" "$src/pnglibconf.h"
  mkdir -p "$TC/libpng/include" "$TC/libpng/lib" "$src/obj"
  # Disable the optional SIMD paths so no extra arch-specific sources are needed.
  for f in png pngerror pngget pngmem pngpread pngread pngrio pngrtran pngrutil \
           pngset pngtrans pngwio pngwrite pngwtran pngwutil; do
    "$NATIVE_CC" -O2 -DPNG_ARM_NEON_OPT=0 -DPNG_INTEL_SSE_OPT=0 -I"$src" \
       -c "$src/$f.c" -o "$src/obj/$f.o"
  done
  ar rcs "$TC/libpng/lib/libpng.a" "$src"/obj/*.o
  cp "$src/png.h" "$src/pngconf.h" "$src/pnglibconf.h" "$TC/libpng/include/"
fi
echo ">> libpng: $TC/libpng/lib/libpng.a"

echo
echo "Toolchain ready ($PLATFORM-$BITS). Build with: scripts/build-rom.sh"
