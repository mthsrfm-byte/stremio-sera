#!/bin/bash
# Usa as mesmas fontes e dylibs fixadas do app, sem compilar os helpers FFmpeg.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="$ROOT/.build/native-deps"
mkdir -p "$ROOT/.build/player-probe" "$ROOT/artifacts"
ARCH="$(uname -m)"
xcrun swiftc -parse-as-library -swift-version 5 -target "$ARCH-apple-macosx13.0" \
    -I "$ROOT/Sources/CMPV" -I "$DEPS/include" -L "$DEPS/lib" -lmpv \
    -framework AppKit -framework OpenGL -framework WebKit \
    -Xlinker -rpath -Xlinker "$DEPS/lib" \
    "$ROOT/Sources/Seraflix/MPVPlayer.swift" "$ROOT/scripts/PlayerProbe.swift" \
    -o "$ROOT/.build/player-probe/PlayerProbe"
PROBE_ARGS=("$ROOT/artifacts/player-probe.json")
if [ "$#" -gt 0 ]; then
    PROBE_LABEL="${2:-video}"
    PROBE_ARGS=("$ROOT/artifacts/player-probe-$PROBE_LABEL.json" --smoke-test --video "$1")
    if [ "$#" -gt 2 ]; then PROBE_ARGS+=("${@:3}"); fi
fi
DYLD_LIBRARY_PATH="$DEPS/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" \
    "$ROOT/.build/player-probe/PlayerProbe" "${PROBE_ARGS[@]}"
