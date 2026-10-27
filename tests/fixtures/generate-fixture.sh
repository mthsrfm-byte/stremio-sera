#!/usr/bin/env bash
# Requer FFmpeg com libx265. Gera uma derivação equivalente; bytes podem variar por versão/muxer.
set -euo pipefail
cd -- "$(dirname -- "$0")"
source_url='https://test-videos.co.uk/vids/bigbuckbunny/mp4/h265/1080/Big_Buck_Bunny_1080_10s_1MB.mp4'
curl --fail --location --retry 3 "$source_url" --output bbb-hevc-1080p.mp4
python3 - <<'PY'
from pathlib import Path
import hashlib
assert hashlib.sha256(Path('bbb-hevc-1080p.mp4').read_bytes()).hexdigest() == 'e0b532ae14e76bf0466d29110b5d8852b8c86ee39f66996bb79db43f8ffc687f'
PY
ffmpeg -hide_banner -loglevel warning -y -i bbb-hevc-1080p.mp4 \
  -f lavfi -i sine=frequency=440:duration=4:sample_rate=48000 \
  -f lavfi -i sine=frequency=880:duration=4:sample_rate=48000 \
  -i seraflix-test.srt -t 4 \
  -map 0:v:0 -map 1:a:0 -map 2:a:0 -map 3:s:0 \
  -vf scale=3840:2160 -pix_fmt yuv420p10le -c:v libx265 -preset ultrafast -crf 30 \
  -x265-params pools=4:frame-threads=2:log-level=error \
  -c:a:0 aac -b:a:0 128k -ac:a:0 2 -c:a:1 aac -b:a:1 384k -ac:a:1 6 -c:s srt \
  -metadata title='Big Buck Bunny — teste Seraflix 4K upscale' \
  -metadata comment='CC BY 3.0: (c) copyright 2008, Blender Foundation / www.bigbuckbunny.org; derivação curta upscale HEVC10bit, tons sintéticos e legenda de teste adicionados.' \
  -metadata:s:a:0 language=por -metadata:s:a:0 title='Teste estéreo 440 Hz' \
  -metadata:s:a:1 language=eng -metadata:s:a:1 title='Teste 5.1 880 Hz' \
  -metadata:s:s:0 language=por -metadata:s:s:0 title='Legenda de teste Seraflix' \
  hevc-4k-tracks.mkv
