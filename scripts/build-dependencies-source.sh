#!/bin/bash
# Release: compila o conjunto inteiro e arquiva exatamente fontes, patches e receitas utilizados.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
WORK="$ROOT/.build/iina-source"
DEPS="$ROOT/.build/native-deps"
COMMIT="$(python3 -c 'import json; print(json.load(open("scripts/dependency-lock.json"))["buildScripts"]["commit"])')"
MARKER="$DEPS/source-$ARCH.commit"
mkdir -p "$ROOT/.build" "$ROOT/artifacts" "$DEPS/notices"
if [ ! -f "$MARKER" ] || [ "$(cat "$MARKER")" != "$COMMIT" ]; then
    if [ ! -d "$WORK/.git" ]; then
        git init -q "$WORK"
        git -C "$WORK" remote add origin https://github.com/iina/deps-buildscripts.git
    fi
    git -C "$WORK" fetch --depth=1 origin "$COMMIT"
    git -C "$WORK" checkout --detach --force FETCH_HEAD
    # A receita fixa deployment12; isso continua compatível com nosso mínimo13.
    (cd "$WORK" && ./build.sh "$ARCH" && ./fix-install-names.sh "$ARCH")
    rm -rf "$DEPS/lib" "$DEPS/include"
    mkdir -p "$DEPS/lib/pkgconfig" "$DEPS/include/mpv"
    cp "$WORK/output/$ARCH/"*.dylib "$DEPS/lib/"
    cp "$WORK/install/$ARCH/include/mpv/"*.h "$DEPS/include/mpv/"
    ln -sf libmpv.2.dylib "$DEPS/lib/libmpv.dylib"
    printf '%s\n' "$COMMIT" > "$MARKER"
fi
cat > "$DEPS/lib/pkgconfig/mpv.pc" <<PC
prefix=$DEPS
libdir=\${prefix}/lib
includedir=\${prefix}/include
Name: mpv
Description: libmpv compilado das fontes IINA fixadas
Version: 0.41.0
Libs: -L\${libdir} -lmpv
Cflags: -I\${includedir}
PC
# Helpers continuam na fonte oficial FFmpeg fixada, independentemente da libav interna do player.
python3 - "$ROOT" <<'PY'
import pathlib, runpy, sys
root = pathlib.Path(sys.argv[1])
module = runpy.run_path(str(root/'scripts/prepare-dependencies.py'), run_name='dependency_library')
archive = module['download'](module['lock']['ffmpegSource'])
(root/'.build/native-deps/ffmpeg-source-path.txt').write_text(str(archive))
PY
# Conserva todas as fontes usadas, além dos patches/receitas do commit exato.
# Não remover fontes GPL nem submódulos; somente artefatos intermediários e metadados Git.
tar -czf "$ROOT/artifacts/Seraflix-deps-source-$ARCH.tar.gz" \
    --exclude='.git' --exclude='./build' --exclude='./install' --exclude='./output' \
    -C "$WORK" .
cp "$WORK/versions.env" "$DEPS/notices/player-source-versions.env"
cp "$WORK/readme.md" "$DEPS/notices/IINA-build-recipes.md"
printf 'Receita fonte exata: https://github.com/iina/deps-buildscripts/tree/%s\nArquivo de fontes: Seraflix-deps-source-%s.tar.gz\n' "$COMMIT" "$ARCH" > "$DEPS/notices/PLAYER-SOURCES.txt"
# Licenças e avisos completos, mantendo o caminho relativo para componentes homônimos.
python3 - "$WORK" "$DEPS/notices" <<'PY'
from pathlib import Path
import shutil, sys
work, notices = map(Path, sys.argv[1:])
for p in (work/'sources').rglob('*'):
    name = p.name.upper()
    if p.is_file() and not p.is_symlink() and (name.startswith(('COPYING', 'LICENSE', 'COPYRIGHT', 'NOTICE', 'AUTHORS'))):
        destination = notices/'player-components'/p.relative_to(work/'sources')
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, destination)
PY
