#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build/torrent-test
cat > .build/torrent-test/package.json <<'JSON'
{"name":"seraflix-local-torrent-test","private":true,"version":"1.0.0","devDependencies":{"webtorrent":"1.9.7","bittorrent-tracker":"9.19.0"}}
JSON
# Sem compilar extensões opcionais: o teste usa somente TCP e tracker HTTP locais.
npm install --prefix .build/torrent-test --ignore-scripts --omit=optional --no-audit --no-fund
