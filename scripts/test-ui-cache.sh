#!/bin/bash
# Compila o validador real com Foundation/CryptoKit, sem importar o player/AppKit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$(uname -s)" != Darwin ]; then
    echo 'O teste Swift do cache exige o SDK macOS e CryptoKit.' >&2
    exit 1
fi
mkdir -p "$ROOT/.build/ui-cache-tests"
xcrun swiftc -parse-as-library -O \
    "$ROOT/Sources/Seraflix/UIBundle.swift" "$ROOT/scripts/UICacheTests.swift" \
    -o "$ROOT/.build/ui-cache-tests/UICacheTests"
"$ROOT/.build/ui-cache-tests/UICacheTests"
