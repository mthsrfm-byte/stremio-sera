#!/bin/bash
# Exercita um .app real no runner; não substitui teste de conta/debrid/torrent no Mac do usuário.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
APP="$ROOT/build/$ARCH/Seraflix.app"
mkdir -p "$ROOT/build/smoke-media"
"$APP/Contents/Helpers/ffmpeg" -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x360:rate=24 -t 4 -c:v mpeg4 -q:v 4 -movflags +faststart -y "$ROOT/build/smoke-media/generated.mp4"
# O app e o diagnóstico isolado usam a mesma mídia conhecida. O arquivo gerado
# pelo helper também é anexado, permitindo investigar encoder e player à parte.
cp "$ROOT/tests/fixtures/mpeg4-smoke.mp4" "$ROOT/build/smoke-media/sample.mp4"
cp "$ROOT/tests/fixtures/hevc-4k-tracks.mkv" "$ROOT/build/smoke-media/"
printf '%s  %s\n' 6cbf117eea73fc860246c4810ac9a78cd9dac13911dbd60eb0acfab3c8267325 "$ROOT/build/smoke-media/hevc-4k-tracks.mkv" | shasum -a 256 -c -
python3 "$ROOT/scripts/serve-fixtures.py" 18765 --bind 127.0.0.1 --directory "$ROOT/build/smoke-media" > "$ROOT/build/smoke-http.log" 2>&1 &
HTTP_PID=$!
cleanup() {
  local result=$?
  if [ "$result" != 0 ]; then cat "$ROOT/build/smoke-http.log"; fi
  kill "$HTTP_PID" 2>/dev/null || true
}
trap cleanup EXIT
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:18765/sample.mp4 -o /dev/null
run_smoke() {
local RESULT="$ROOT/build/smoke-$ARCH-$1.json"
local MEDIA="$2"
shift 2
rm -f "$RESULT"
open -n -W "$APP" --args --smoke-test "$RESULT" --smoke-server --smoke-video "$MEDIA" "$@"
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

}
SMOKE_FAILED=0
run_smoke mpeg4 http://127.0.0.1:18765/sample.mp4 || SMOKE_FAILED=1
run_smoke hevc-4k http://127.0.0.1:18765/hevc-4k-tracks.mkv --smoke-tracks || SMOKE_FAILED=1

# O terceiro vídeo vem de um torrent privado sem depender de seeders da Internet.
"$ROOT/scripts/setup-torrent-test.sh"
GATE="$ROOT/build/torrent-url.txt"
RESULT="$ROOT/build/smoke-$ARCH-torrent.json"
rm -f "$GATE" "$RESULT"
open -n "$APP" --args --smoke-test "$RESULT" --smoke-torrent-file "$GATE" --smoke-tracks
node "$ROOT/scripts/test-server-torrent.mjs" "$GATE" "$RESULT" || SMOKE_FAILED=1
if [ -f "$RESULT" ]; then cat "$RESULT"; fi
exit "$SMOKE_FAILED"
