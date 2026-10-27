#!/usr/bin/env python3
"""Baixa somente os artefatos fixados, valida SHA-256 e prepara o sysroot local."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

root = Path(__file__).resolve().parent.parent
lock = json.loads((root / 'scripts/dependency-lock.json').read_text())
deps = root / '.build/native-deps'
cache = root / '.build/downloads'
cache.mkdir(parents=True, exist_ok=True)
(deps / 'lib/pkgconfig').mkdir(parents=True, exist_ok=True)
(deps / 'include/mpv').mkdir(parents=True, exist_ok=True)

def download(item):
    name = item.get('name') or item['url'].split('/')[-1]
    target = cache / name
    expected = item['sha256']
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        temporary = target.with_name(target.name + '.download')
        subprocess.run(['curl', '--fail', '--location', '--retry', '3', '--retry-all-errors', '--retry-delay', '2', '--max-time', '120', '--silent', '--show-error', '--max-time', '120', item['url'], '-o', str(temporary)], check=True)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != expected:
            temporary.unlink()
            raise RuntimeError('SHA-256 incorreto: ' + name)
        temporary.replace(target)
    return target

if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(pool.map(download, lock['libraries']))
    for path in paths:
        shutil.copy2(path, deps / 'lib' / path.name)
    source = download(lock['mpvHeaders'])
    # Extrai apenas headers conhecidos; nunca executa ou extrai caminhos do arquivo remoto.
    with tarfile.open(source) as archive:
        for name in ('client.h', 'render.h', 'render_gl.h', 'stream_cb.h'):
            members = [m for m in archive.getmembers() if (m.name.endswith('/include/mpv/' + name) or m.name.endswith('/libmpv/' + name))]
            if len(members) != 1 or not members[0].isfile():
                raise RuntimeError('Header ausente: ' + name)
            (deps / 'include/mpv' / name).write_bytes(archive.extractfile(members[0]).read())
    link = deps / 'lib/libmpv.dylib'
    link.unlink(missing_ok=True)
    link.symlink_to('libmpv.2.dylib')
    (deps / 'lib/pkgconfig/mpv.pc').write_text(f'''prefix={deps}
libdir=${{prefix}}/lib
includedir=${{prefix}}/include
Name: mpv
Description: libmpv oficial IINA, snapshot validado pelo Seraflix
Version: 0.41.0
Libs: -L${{libdir}} -lmpv
Cflags: -I${{includedir}}
''')
    ffmpeg = download(lock['ffmpegSource'])
    (deps / 'ffmpeg-source-path.txt').write_text(str(ffmpeg))
    print(f'Dependências verificadas em {deps}')
