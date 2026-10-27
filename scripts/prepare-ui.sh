#!/bin/bash
# O fonte da UI fica no repositório original; só o resultado do build entra no fallback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UI_REF="${UI_REF:-main}"
UI_SOURCE="${UI_SOURCE:-https://github.com/mthsrfm-byte/stremio-sera.git}"
CHECKOUT="$ROOT/.build/ui-repository"
mkdir -p "$ROOT/.build"
if [ ! -d "$CHECKOUT/.git" ]; then
    git init -q "$CHECKOUT"
    git -C "$CHECKOUT" remote add origin "$UI_SOURCE"
fi
git -C "$CHECKOUT" remote set-url origin "$UI_SOURCE"
git -C "$CHECKOUT" fetch --depth=1 origin "$UI_REF"
git -C "$CHECKOUT" checkout --detach --force FETCH_HEAD
UI_COMMIT="$(git -C "$CHECKOUT" rev-parse HEAD)"
export KAI_COMMIT="$UI_COMMIT"
export KAI_BUILD_DATE="$(git -C "$CHECKOUT" show -s --format=%cI HEAD)"
export KAI_COMMIT_MSG="$(git -C "$CHECKOUT" show -s --format=%s HEAD)"
(cd "$CHECKOUT" && npm ci && npm run build:mac)
node "$ROOT/scripts/verify-ui.mjs" "$CHECKOUT/site/mac"
# Substituição atômica da pasta evita snapshot parcial se o build falhar.
rm -rf "$ROOT/Resources/fallback.new"
cp -R "$CHECKOUT/site/mac" "$ROOT/Resources/fallback.new"
rm -rf "$ROOT/Resources/fallback"
mv "$ROOT/Resources/fallback.new" "$ROOT/Resources/fallback"
printf '%s\n' "$UI_COMMIT" > "$ROOT/Resources/ui-source-commit.txt"
echo "Fallback gerado do commit $UI_COMMIT"
