#!/bin/bash
# Exercita um .app real no runner; não substitui teste de conta/debrid/torrent no Mac do usuário.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
APP="$ROOT/build/$ARCH/Seraflix.app"
mkdir -p "$ROOT/build/smoke-media"
"$APP/Contents/Helpers/ffmpeg" -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x360:rate=24 -t 4 -c:v mpeg4 -q:v 4 -y "$ROOT/build/smoke-media/sample.mp4"
python3 -m http.server 18765 --bind 127.0.0.1 --directory "$ROOT/build/smoke-media" > "$ROOT/build/smoke-http.log" 2>&1 &
HTTP_PID=$!
trap 'kill "$HTTP_PID" 2>/dev/null || true' EXIT
RESULT="$ROOT/build/smoke-$ARCH.json"
rm -f "$RESULT"
open -n "$APP" --args --smoke-test "$RESULT" --smoke-video http://127.0.0.1:18765/sample.mp4
python3 - "$RESULT" <<'PY'
import json, pathlib, sys, time
p = pathlib.Path(sys.argv[1])
for _ in range(90):
    if p.exists():
        result = json.loads(p.read_text())
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if not result.get('ok'):
            raise SystemExit('Smoke test reportou falha')
        break
    time.sleep(1)
else:
    raise SystemExit('App não concluiu smoke test em 90 segundos')
PY
