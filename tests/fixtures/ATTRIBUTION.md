# Fixture técnica: Big Buck Bunny / Seraflix

**(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org**

Big Buck Bunny está sob [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
A licença e a fórmula de atribuição são declaradas pelo produtor em
https://peach.blender.org/about/ (seção “License information”).

Fonte do recorte HEVC de 10 segundos e 1920×1080, sem áudio:
https://test-videos.co.uk/vids/bigbuckbunny/mp4/h265/1080/Big_Buck_Bunny_1080_10s_1MB.mp4
Página do fornecedor: https://test-videos.co.uk/bigbuckbunny/mp4-h265

SHA-256 da fonte (1.049.468 bytes):
`e0b532ae14e76bf0466d29110b5d8852b8c86ee39f66996bb79db43f8ffc687f`

`hevc-4k-tracks.mkv` é uma **derivação para testes**: recorte de aproximadamente
4,2 segundos, upscale para 3840×2160, HEVC Main10 / yuv420p10le, áudio sintético
AAC estéreo a 440 Hz e AAC 5.1 a 880 Hz, com legendas SRT de teste em português.
As etiquetas de idioma servem apenas ao teste de seleção; não são dublagens.
É SDR, sem metadados PQ/HLG/HDR. O upscale valida a resolução do pipeline,
sem afirmar detalhe 4K nativo ou suporte HDR.

SHA-256 do arquivo pré-gerado (1.064.363 bytes):
`6cbf117eea73fc860246c4810ac9a78cd9dac13911dbd60eb0acfab3c8267325`

Preparado com FFmpeg 7.1.5 / libx265. `generate-fixture.sh` baixa a fonte,
verifica seu SHA-256 e gera uma fixture com as mesmas características.
Bytes do derivado podem variar entre versões do encoder/muxer; o hash acima
identifica especificamente o arquivo pré-gerado. Preserve este aviso junto
com a fixture ao redistribuí-la.

O teste de reprodução desta fixture via HTTP local não substitui a validação
com credenciais reais de debrid, torrent pela rede ou inspeção visual em um Mac.


`mpeg4-smoke.mp4` também é um padrão sintético `testsrc2`, gerado nesta tarefa
com FFmpeg (sem material audiovisual externo), disponibilizado em CC0-1.0.
Comando: `ffmpeg -f lavfi -i testsrc2=size=640x360:rate=24 -t 4 -c:v mpeg4 -q:v 4 mpeg4-smoke.mp4`.
SHA-256: `7819454a878f64ac13a80e4d1f5bc3c34f18036b9b5abe493247e069998f4805`.
Serve para isolar falhas de codec/VO do smoke que gera MPEG4 no próprio runner.
