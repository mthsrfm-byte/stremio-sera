#!/bin/bash
# Gera um app autocontido da arquitetura atual. Não requer Homebrew no Mac do usuário.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ "$(uname -s)" != Darwin ]; then echo 'Execute este script no macOS (ou use GitHub Actions).' >&2; exit 1; fi
ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in arm64) NODE_ARCH=arm64; NODE_SHA=db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000;; x86_64) NODE_ARCH=x64; NODE_SHA=12a6abb9c2902cf48a21120da13f87fde1ed1b71a13330712949e8db818708ba;; *) echo 'Arquitetura não suportada' >&2; exit 1;; esac
export ARCH MACOSX_DEPLOYMENT_TARGET=13.0
VERSION="${VERSION:-0.1.0}"
VERSION="${VERSION#v}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
DEPS="$ROOT/.build/native-deps"
ARTIFACTS="$ROOT/artifacts"
APP="$ROOT/build/$ARCH/Seraflix.app"
mkdir -p "$ARTIFACTS" "$ROOT/.build/downloads"
if [ "${SKIP_UI_BUILD:-0}" != 1 ]; then "$ROOT/scripts/prepare-ui.sh"; fi
node "$ROOT/scripts/verify-ui.mjs" "$ROOT/Resources/fallback"
if [ "${DEPS_MODE:-binary}" = source ]; then
    "$ROOT/scripts/build-dependencies-source.sh"
else
    python3 "$ROOT/scripts/prepare-dependencies.py"
fi
export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
# pkg-config é ferramenta de compilação; não é dependência do .app.
command -v pkg-config >/dev/null || { echo 'Instale pkg-config (brew install pkgconf).' >&2; exit 1; }
swift build -c release --arch "$ARCH"
BIN_DIR="$(swift build -c release --arch "$ARCH" --show-bin-path)"
"$ROOT/scripts/build-ffmpeg.sh"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Helpers" "$APP/Contents/Frameworks" "$APP/Contents/Resources/licenses"
cp "$BIN_DIR/Seraflix" "$APP/Contents/MacOS/"
cp "$ROOT/Resources/Info.plist" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :SUFeedURL https://github.com/mthsrfm-byte/stremio-sera-mac/releases/latest/download/appcast-$ARCH.xml" "$APP/Contents/Info.plist"
if [ -n "${SPARKLE_PUBLIC_KEY:-}" ]; then
    /usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string $SPARKLE_PUBLIC_KEY" "$APP/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c 'Set :SUEnableAutomaticChecks true' "$APP/Contents/Info.plist"
fi
cp -R "$ROOT/Resources/fallback" "$APP/Contents/Resources/"
cp "$ROOT/Resources/ui-source-commit.txt" "$APP/Contents/Resources/"
cp "$ROOT/Resources/server-bootstrap.cjs" "$APP/Contents/Resources/"
cp "$ROOT/LICENSE" "$APP/Contents/Resources/licenses/Seraflix-GPL-3.0.txt"
cp -R "$ROOT/Resources/licenses/." "$APP/Contents/Resources/licenses/"
cp "$ROOT/docs/dependencies.md" "$APP/Contents/Resources/licenses/DEPENDENCIAS.md"
cp "$ROOT/scripts/dependency-lock.json" "$APP/Contents/Resources/licenses/"
cp -R "$DEPS/notices/." "$APP/Contents/Resources/licenses/"
cp "$DEPS/bin/ffmpeg" "$DEPS/bin/ffprobe" "$APP/Contents/Helpers/"
SPARKLE="$(find "$ROOT/.build/artifacts" -type d -name Sparkle.framework | head -n 1)"
[ -n "$SPARKLE" ] || { echo 'Sparkle.framework não encontrado.' >&2; exit 1; }
cp -R "$SPARKLE" "$APP/Contents/Frameworks/"
NODE_ARCHIVE="$ROOT/.build/downloads/node-v22.22.2-darwin-$NODE_ARCH.tar.gz"
if [ ! -f "$NODE_ARCHIVE" ]; then curl --fail --location --retry 3 "https://nodejs.org/dist/v22.22.2/node-v22.22.2-darwin-$NODE_ARCH.tar.gz" -o "$NODE_ARCHIVE"; fi
printf '%s  %s\n' "$NODE_SHA" "$NODE_ARCHIVE" | shasum -a 256 -c -
NODE_DIR="$ROOT/.build/node-$NODE_ARCH"
mkdir -p "$NODE_DIR"
tar -xzf "$NODE_ARCHIVE" -C "$NODE_DIR" --strip-components=1
cp "$NODE_DIR/bin/node" "$APP/Contents/Helpers/node"
cp "$NODE_DIR/LICENSE" "$APP/Contents/Resources/licenses/Node-MIT-e-terceiros.txt"
# Nunca incorporar o bundle cuja redistribuição não foi esclarecida.
if find "$APP" -name server.js | grep -q .; then echo 'server.js não pode ser redistribuído dentro do app.' >&2; exit 1; fi
python3 "$ROOT/scripts/bundle-macho.py" "$APP" --arch "$ARCH" --deps "$DEPS/lib" --identity "${SIGN_IDENTITY:--}"
cp "$ROOT/docs/build.md" "$ARTIFACTS/LEIA-ME-build.md"
cp "$ROOT/docs/dependencies.md" "$ARTIFACTS/DEPENDENCIAS.md"
STAGING="$ROOT/build/dmg-$ARCH"
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
DMG="$ARTIFACTS/Seraflix-$VERSION-$ARCH.dmg"
ZIP="$ARTIFACTS/Seraflix-$VERSION-$ARCH.zip"
rm -f "$DMG" "$ZIP"
hdiutil create -volname Seraflix -srcfolder "$STAGING" -ov -format UDZO "$DMG"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
(cd "$ARTIFACTS" && shasum -a 256 "$(basename "$DMG")" "$(basename "$ZIP")" > "SHA256SUMS-$ARCH.txt")
if [ "${DEPS_MODE:-binary}" = source ]; then
    cp "$(cat "$DEPS/ffmpeg-source-path.txt")" "$ARTIFACTS/ffmpeg-9.0.2-source.tar.xz"
fi
echo "App: $APP"
echo "DMG: $DMG"
