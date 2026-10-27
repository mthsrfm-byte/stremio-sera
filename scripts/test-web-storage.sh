#!/bin/bash
# Usa AppKit/WebKit reais para detectar logout causado por troca do path da UI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$(uname -s)" != Darwin ]; then
    echo 'O teste de origem do armazenamento exige macOS com sessão gráfica.' >&2
    exit 1
fi
mkdir -p "$ROOT/.build/web-storage-tests"
xcrun swiftc -parse-as-library -O -framework AppKit -framework WebKit \
    "$ROOT/scripts/StorageOriginTests.swift" \
    -o "$ROOT/.build/web-storage-tests/StorageOriginTests"
"$ROOT/.build/web-storage-tests/StorageOriginTests"
