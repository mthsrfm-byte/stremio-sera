#!/usr/bin/env python3
"""Reloca dependências, valida arquitetura/minOS e assina o bundle de dentro para fora."""
import argparse
import os
import plistlib
from pathlib import Path
import re
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('app', type=Path)
parser.add_argument('--arch', required=True, choices=('arm64', 'x86_64'))
parser.add_argument('--deps', type=Path, required=True)
parser.add_argument('--identity', default='-')
args = parser.parse_args()
app = args.app.resolve()
frameworks = app / 'Contents/Frameworks'
frameworks.mkdir(parents=True, exist_ok=True)

def run(*command):
    return subprocess.check_output(command, text=True).strip()

def macho(path):
    return path.is_file() and not path.is_symlink() and 'Mach-O' in run('file', '-b', str(path))

# As dylibs oficiais IINA usam @rpath e incluem as duas arquiteturas. Cada app leva só a sua.
for lib in sorted(args.deps.glob('*.dylib')):
    target = frameworks / lib.name
    if not target.exists():
        shutil.copy2(lib, target)

# Sparkle contém executáveis auxiliares e bundles aninhados; preservar todos.
files = [p for p in app.rglob('*') if macho(p)]
for path in files:
    arches = run('lipo', '-archs', str(path)).split()
    if args.arch not in arches:
        raise SystemExit(f'Arquitetura {args.arch} ausente em {path}')
    if len(arches) > 1:
        temporary = path.with_name(path.name + '.thin')
        subprocess.run(['lipo', str(path), '-thin', args.arch, '-output', str(temporary)], check=True)
        os.replace(temporary, path)
    # Qualquer alteração posterior à assinatura invalida o selo anterior.
    subprocess.run(['codesign', '--remove-signature', str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Reescreve apenas caminhos de desenvolvimento; referências Apple não são copiadas.
for path in files:
    dependencies = run('otool', '-L', str(path)).splitlines()[1:]
    for line in dependencies:
        dependency = line.strip().split(' (', 1)[0]
        if dependency.startswith(('/System/Library/', '/usr/lib/', '@')):
            continue
        name = Path(dependency).name
        if (frameworks / name).exists():
            subprocess.run(['install_name_tool', '-change', dependency, '@rpath/' + name, str(path)], check=True)
        else:
            raise SystemExit(f'Dependência fora do app: {path}: {dependency}')
    if path.suffix == '.dylib':
        subprocess.run(['install_name_tool', '-id', '@rpath/' + path.name, str(path)], check=True)
    commands = run('otool', '-l', str(path))
    minimums = re.findall(r'\bminos\s+(\d+(?:\.\d+){0,2})', commands)
    # Mach-O antigos usam LC_VERSION_MIN_MACOSX.
    minimums += re.findall(r'cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version (\d+(?:\.\d+){0,2})', commands)
    if not minimums:
        raise SystemExit(f'Mach-O sem deployment target verificável: {path}')
    for minimum in minimums:
        version = tuple(map(int, minimum.split('.')))
        if version + (0,) * (3 - len(version)) > (13, 0, 0):
            raise SystemExit(f'{path}: requer macOS {minimum}; alvo é 13.0')

# Falha se restar uma dependência absoluta de Homebrew/máquina de build.
for path in files:
    linked = run('otool', '-L', str(path))
    if '/opt/homebrew/' in linked or '/usr/local/' in linked or '/.build/' in linked:
        raise SystemExit(f'Caminho de desenvolvimento no Mach-O: {path}')

# Assinar o executável principal diretamente faz codesign reconhecer o bundle inteiro
# e validar seus filhos antes da hora. Cada main é assinado somente pelo seu bundle,
# depois de todas as dependências e bundles mais internos estarem assinados.
bundles = [p for p in app.rglob('*') if not p.is_symlink() and p.is_dir() and p.suffix in ('.framework', '.xpc', '.app', '.bundle')]
bundle_executables = set()
for bundle in [app, *bundles]:
    for info in (bundle / 'Contents/Info.plist', bundle / 'Resources/Info.plist', bundle / 'Info.plist'):
        if info.is_file():
            executable = plistlib.loads(info.read_bytes()).get('CFBundleExecutable')
            if executable:
                for candidate in (bundle / 'Contents/MacOS' / executable, bundle / executable):
                    if candidate.is_file():
                        bundle_executables.add(candidate.resolve())
            break
# A aplicação não depende de um Info.plist ausente para excluir seu main nesta etapa.
bundle_executables.add((app / 'Contents/MacOS/Seraflix').resolve())
leaves = [p for p in files if p.resolve() not in bundle_executables]
for path in sorted(leaves, key=lambda p: (p.suffix != '.dylib', -len(p.parts))):
    subprocess.run(['codesign', '--force', '--sign', args.identity, '--timestamp=none', str(path)], check=True)
for path in sorted(bundles, key=lambda p: len(p.parts), reverse=True):
    subprocess.run(['codesign', '--force', '--sign', args.identity, '--timestamp=none', str(path)], check=True)
subprocess.run(['codesign', '--force', '--sign', args.identity, '--timestamp=none', str(app)], check=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)], check=True)
print(f'Bundle validado: {args.arch}, macOS 13+, dependências locais, assinatura {args.identity}')
