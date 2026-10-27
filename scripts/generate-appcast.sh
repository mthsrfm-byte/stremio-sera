#!/bin/bash
# Assina a atualização nativa com Ed25519; o segredo entra somente por stdin da ferramenta.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
VERSION="${VERSION:-0.1.0}"
VERSION="${VERSION#v}"
TAG="${RELEASE_TAG:-v$VERSION}"
REPOSITORY="${RELEASE_REPOSITORY:-mthsrfm-byte/stremio-sera-mac}"
if [ -z "${SPARKLE_PRIVATE_KEY:-}" ]; then
    echo 'Appcast não gerado: configure SPARKLE_PRIVATE_KEY para assinar atualizações nativas.'
    exit 0
fi
[ -n "${SPARKLE_PUBLIC_KEY:-}" ] || { echo 'SPARKLE_PUBLIC_KEY também é necessária no build.' >&2; exit 1; }
TOOLS="$ROOT/.build/sparkle-tools"
ARCHIVE="$ROOT/.build/downloads/Sparkle-2.10.1.tar.xz"
mkdir -p "$(dirname "$ARCHIVE")" "$TOOLS"
if [ ! -f "$ARCHIVE" ]; then
    curl --fail --location --retry 3 https://github.com/sparkle-project/Sparkle/releases/download/2.10.1/Sparkle-2.10.1.tar.xz -o "$ARCHIVE"
fi
printf '%s  %s\n' 1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27 "$ARCHIVE" | shasum -a 256 -c -
tar -xf "$ARCHIVE" -C "$TOOLS"
WORK="$ROOT/.build/appcast-$ARCH"
rm -rf "$WORK"
mkdir -p "$WORK"
cp "$ROOT/artifacts/Seraflix-$VERSION-$ARCH.zip" "$WORK/"
cp "$ROOT/docs/release.md" "$WORK/Seraflix-$VERSION-$ARCH.md"
printf '%s\n' "$SPARKLE_PRIVATE_KEY" | "$TOOLS/bin/generate_appcast" \
    --ed-key-file - \
    --download-url-prefix "https://github.com/$REPOSITORY/releases/download/$TAG/" \
    --link "https://github.com/$REPOSITORY" \
    --embed-release-notes \
    "$WORK"
cp "$WORK/appcast.xml" "$ROOT/artifacts/appcast-$ARCH.xml"
echo "Appcast assinado: artifacts/appcast-$ARCH.xml; publique o XML no Pages configurado no app."
