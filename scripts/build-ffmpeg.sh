#!/bin/bash
# Helpers independentes das dylibs do mpv; somente bibliotecas Apple e código LGPL oficial.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
DEPS="$ROOT/.build/native-deps"
ARCHIVE="$(cat "$DEPS/ffmpeg-source-path.txt")"
SOURCE_HASH="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
RECIPE_HASH="$(shasum -a 256 "$ROOT/scripts/build-ffmpeg.sh" | awk '{print $1}')"
VERSION_HASH="$(printf '%s\n%s\n' "$SOURCE_HASH" "$RECIPE_HASH" | shasum -a 256 | awk '{print $1}')"
MARKER="$DEPS/ffmpeg-$ARCH.sha256"
if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$VERSION_HASH" ] && [ -x "$DEPS/bin/ffmpeg" ] && [ -x "$DEPS/bin/ffprobe" ]; then
    exit 0
fi
WORK="$ROOT/.build/ffmpeg-$ARCH"
rm -rf "$WORK"
mkdir -p "$WORK" "$DEPS/bin"
tar -xf "$ARCHIVE" -C "$WORK" --strip-components=1
export MACOSX_DEPLOYMENT_TARGET=13.0
(cd "$WORK" && ./configure \
    --prefix="$DEPS/ffmpeg-install" --arch="$ARCH" --cc=clang \
    --extra-cflags='-mmacosx-version-min=13.0' \
    --extra-ldflags='-mmacosx-version-min=13.0' \
    --disable-autodetect --disable-doc --disable-debug --disable-ffplay \
    --disable-x86asm --enable-static --disable-shared --enable-pic \
    --enable-videotoolbox --enable-audiotoolbox --enable-securetransport && \
    make -j "$(sysctl -n hw.logicalcpu)" ffmpeg ffprobe)
cp "$WORK/ffmpeg" "$WORK/ffprobe" "$DEPS/bin/"
mkdir -p "$DEPS/notices"
cp "$WORK/COPYING.LGPLv2.1" "$DEPS/notices/FFmpeg-LGPL-2.1.txt"
cp "$WORK/ffbuild/config.mak" "$DEPS/notices/ffmpeg-config.txt"
printf '%s\n' "$VERSION_HASH" > "$MARKER"
