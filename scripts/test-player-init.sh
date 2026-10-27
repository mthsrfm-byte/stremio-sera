#!/bin/bash
# Usa as mesmas fontes e dylibs fixadas do app, sem compilar os helpers FFmpeg.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="$ROOT/.build/native-deps"
mkdir -p "$ROOT/.build/player-probe" "$ROOT/artifacts"
ARCH="$(uname -m)"
xcrun swiftc -parse-as-library -swift-version 5 -target "$ARCH-apple-macosx13.0" \
    -I "$ROOT/Sources/CMPV" -I "$DEPS/include" -L "$DEPS/lib" -lmpv \
    -framework AppKit -framework OpenGL \
    -Xlinker -rpath -Xlinker "$DEPS/lib" \
    "$ROOT/Sources/Seraflix/MPVPlayer.swift" "$ROOT/scripts/PlayerProbe.swift" \
    -o "$ROOT/.build/player-probe/PlayerProbe"
DYLD_LIBRARY_PATH="$DEPS/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" \
    "$ROOT/.build/player-probe/PlayerProbe" "$ROOT/artifacts/player-probe.json"
