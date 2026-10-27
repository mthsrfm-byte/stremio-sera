# Estudo e plano do Seraflix para macOS

Leitura feita antes de escrever a implementação, em 27/10/2026. A UI base é `mthsrfm-byte/stremio-sera` commit `bacc0df`, GPL-3.0: JavaScript sem framework, esbuild/Babel Chrome 38, palco 1920×1080, navegação espacial e player HTML5/hls.js. Foram lidos `tools/build.mjs`, `platform.js`, `main.js`, `nav.js`, `player.js`, `server.js`, `src/web/` e workflows. O Mac acrescentará um destino sem copiar src para este repositório. Builds TV/web de referência foram gerados antes de alterações.

## Stremio/stremio-shell — Qt + libmpv

Fonte estudada: commit `c3a8bcbf857d5569b6ae7444ead0dc0a0814888b`, branch `master`, em 27/10/2026. Repositório GPL-3.0 (`LICENSE.md`).

- `mpv.cpp`, `mpv.h`: `MpvObject` herda `QQuickFramebufferObject`. `mpv_create`/`mpv_initialize` criam o player e `mpv_render_context_create` usa `MPV_RENDER_API_TYPE_OPENGL`; o callback de atualização pede redraw. O render recebe FBO/tamanho e desenha via `mpv_render_context_render`. Destruição libera o render context e depois `mpv_terminate_destroy`.
- `main.qml`, bloco `MpvObject` e `WebEngineView`: o vídeo ocupa o palco inteiro e a interface web tem fundo transparente, por cima. Não é necessário enviar pixels pelo JS. Esse é o padrão a reaproveitar no macOS com NSOpenGLView abaixo de WKWebView.
- `main.qml`, `transport`: `QWebChannel` publica `onEvent` e sinal `event`. Métodos `mpv-command`, `mpv-set-prop`, `mpv-observe-prop` fazem operações; comandos `run` são bloqueados. `app-ready` libera uma fila de eventos. A ponte também informa `shellVersion`, `serverAddress`, fullscreen e falhas do servidor. É melhor especificar API limitada em Seraflix, em vez de expor toda a API mpv.
- `mpv.cpp`: `mpv_set_wakeup_callback` enfileira trabalho no loop Qt. `mpv_observe_property(... MPV_FORMAT_NODE)` observa propriedades; `mpv_wait_event` drena eventos. Eventos de propriedade carregam nome/valor; eventos de fim preservam razão e erro.
- `main.qml`, `Process`/`launchServer`: executa Node empacotado com `server.js`, lê `EngineFS server started at ` para descobrir o endpoint, publica `server-address`, conserva falhas e relança após 10 s. Na saída encerra o subprocesso. `stremioprocess.cpp` mantém as últimas 200 linhas de stderr.
- `autoupdater.cpp`: atualização de `server.js` é separada do binário; descriptor assinado e SHA-256 dos arquivos. `mac/fix_osx_deps.sh`: copia dylibs e reescreve install names para distribuição; não depender de Homebrew na máquina do usuário.

Aproveitamento: arquitetura conceitual de composição e de eventos; implementação Swift própria. Não copiar arquivos Qt nem os executáveis e certificados existentes no repositório. A licença GPL-3.0 permite reutilização de código com preservação dos avisos e fornecimento do código fonte correspondente; os binários de terceiros exigem seus próprios avisos/licenças.

## Stremio/stremio-shell-ng — Rust + WebView2 + mpv

Fonte estudada: commit `8d6244da5c078ca395915d59d1f1737f5a6cdb38`, branch `main`, em 27/10/2026. **Não há LICENSE no checkout nem campo `license` em Cargo.toml**; GitHub retorna licença nula. Código publicamente visível não implica autorização de redistribuição. Aproveitamento somente conceitual, sem copiar código. README declara Windows-only; a afirmação de eficiência 2–5× é do upstream, não medição feita em Seraflix e não justifica trocar Swift por Rust.

- `src/stremio_app/stremio_wevbiew/wevbiew.rs`: WebView2 com alpha zero, mensagens postMessage e verificação de origem confiável. Injeta uma compatibilidade `window.qt.webChannelTransport`, reutilizando protocolo da UI antiga. Mensagens nativas são entregues no loop da janela.
- `ipc.rs`: handshake versionado com capacidades; RPC JSON preserva formato Qt (`id`, `args`, `transport`). `stremio_player/communication.rs`: enums limitam propriedades e comandos (`loadfile`, `stop`, `sub-add`, `sub-remove`), valores são tipados; eventos incluem `track-list`, `video-params`, metadados, razão de fim e `load_id` para impedir eventos atrasados da mídia anterior.
- `stremio_player/player.rs`: `wid` recebe HWND, VO `gpu-next,gpu,`, aceleração `hwdec=auto`, renderização direta no Windows, sem textura intermediária Qt. Um cliente mpv separado processa eventos; um worker de legendas faz comandos assíncronos e cancela trabalhos ao trocar mídia, evitando bloquear UI. Isso orienta uso de fila serial, IDs de sessão e comandos mpv async no shell Swift.
- `stremio_server/server.rs`/`process.rs`: worker dedicado, timeout de inicialização 30 s, stdout/stderr drenados simultaneamente, buffer limitado de logs, readiness validada como endpoint HTTP loopback, sinal Ready/Failed à janela. Mata e espera o processo terminar **antes** de permitir retry; Drop pede Stop. `job.rs` usa Windows Job Objects para eliminar descendentes se o shell cair (não transplantável diretamente a macOS).

### Renderização e Apple Silicon

O manual mpv atual (`DOCS/man/options.rst`, seção `--wid`) não documenta NSView/macOS como destino de embedding. `gpu-context=macvk` é Vulkan+Metal experimental e não combina com `gpu-api=opengl`. Para uma primeira versão confiável: render API OpenGL 3.2 de libmpv em NSOpenGLView (como Qt/IINA), `hwdec=videotoolbox`/`auto-safe`, sem polling ativo de frames; VideoToolbox decodifica HEVC por hardware no M1/M3. OpenGL é obsoleto em Apple, mas disponível em macOS 13+; a saída HDR/EDR real não fica garantida por esse caminho (tone mapping para SDR é suportado). Uma camada Metal/EDR exige implementação e teste próprios, não deve ser prometida sem medição em tela HDR.

Referências verificáveis:

- https://github.com/Stremio/stremio-shell/tree/c3a8bcbf857d5569b6ae7444ead0dc0a0814888b
- https://github.com/Stremio/stremio-shell-ng/tree/8d6244da5c078ca395915d59d1f1737f5a6cdb38
- https://mpv.io/manual/master/#options-wid
- https://mpv.io/manual/master/#options-gpu-context


## Stremio Service

Estudado `Stremio/stremio-service` em `1891799734acba88904f9f62cb8ca491873b36fb` (`master`, versão do wrapper 0.1.22).

- Licença do wrapper Rust: **GPL-2.0**, declarada em `Cargo.toml`, README e `LICENSE.md`. Não copiar código Rust GPL-2.0 para o shell GPL-3.0; aproveitar arquitetura por implementação independente em Swift. A licença do wrapper não comprova automaticamente a licença do bundle baixado.
- `build.rs`: baixa `server.js` separadamente de `https://dl.strem.io/server/{versão}/desktop/server.js`; `[package.metadata.server]` fixa **v4.21.1**. Guarda `server_version.txt` para não baixar novamente na compilação. `src/bin/bundle-macos.rs` e metadados macOS empacotam `stremio-runtime`, `server.js`, `ffmpeg`, `ffprobe` junto do executável.
- `src/server.rs`: exige todos os quatro arquivos; executa runtime Node com argumento `server.js`, e `FFMPEG_BIN`/`FFPROBE_BIN`. Guarda `Child`, evita partida duplicada e mata filho no `stop`/`Drop`. Não há supervisor robusto de crash nem reinício com backoff nesse arquivo: o Seraflix deverá acrescentá-los.
- `src/app.rs`: trava de instância única, inicia depois de verificar atualizações, para ao encerrar event loop. Em macOS instala LaunchAgent em modo bundled; não aproveitar esse autostart, pois o requisito é ciclo de vida do próprio app.
- `src/main.rs`: `env_logger`, nível padrão info e variável `RUST_LOG`; stdout/stderr do servidor herdados. Seraflix deve redirecionar logs com rotação para `~/Library/Logs/Seraflix/`.
- `src/updater.rs`, `src/constants.rs`: descritor oficial fornece versão, URL e checksum SHA-256; compara versão, baixa e verifica hash antes de instalar. A atualização é do serviço inteiro, não download independente do server. Nosso shell usa Sparkle para nativo; versão/hash de server deliberadamente fixos no app.
- **Apple Silicon:** workflow oficial `.github/workflows/macos-release.yml` usa `macOS-15-intel`; `file resources/bin/macos/{stremio-runtime,ffmpeg,ffprobe}` confirmou **Mach-O x86_64**, sem arm64. Não empacotar esses binários em versão M1/M3; usar Node oficial darwin-arm64 e dependências compiladas para arm64, com pacote Intel separado. Node oficial MIT suporta as duas arquiteturas. FFmpeg/ffprobe podem ser empacotados do build/Homebrew correspondente, com bibliotecas relocadas e avisos/fontes de licença; o perfil de licença depende da configuração e componentes da fórmula usada.

### Server oficial: licença e decisão

URL examinada: `https://dl.strem.io/server/v4.21.1/desktop/server.js`, SHA-256 **405eb494d6708406a30e716c3cfb5abae7a5e9c7a8b79446d64c3f821385930f**. O bundle contém metadados `stremio-server`, versão interna **4.21.0**, autor Smart Code LTD, `license: "MIT"`. Entretanto o cabeçalho exige `server.js.LICENSE.txt` e `https://dl.strem.io/server/v4.21.1/desktop/server.js.LICENSE.txt` retornou **HTTP 404**. O código inclui dependências de repositórios privados e não se verificou texto completo da licença do conjunto. **Não considerar autorização de redistribuição comprovada e não embutir o server.js no .app/repositório.** Baixar diretamente da fonte oficial na primeira execução, verificar SHA-256 fixado, instalar atomicamente em Application Support e explicar essa decisão no README. O checksum detecta corrupção e alteração do artefato; não substitui licença.

### Portas, isolamento e compatibilidade

O bundle usa `server.listen(11470)` sem host: por padrão abre todas as interfaces. Em conflito incrementa até 11474; isso é incompatível com endereço fixo exigido. Abre HTTPS 12470 salvo `NO_HTTPS_SERVER=1`. A UI deve consumir somente `127.0.0.1:11470`; o bootstrap próprio deve fixar host loopback para esse listener e recusar migração para porta alternativa, além de checar conflito sem matar processo alheio. `NO_CORS=1` habilita requisições da origem local da WKWebView; `CASTING_DISABLED=1` e `NO_HTTPS_SERVER=1` evitam descoberta/endpoint extra. `FFMPEG_BIN`/`FFPROBE_BIN` são suportados explicitamente. O diretório padrão de estado é `~/.stremio-server` no Linux e `~/Library/Application Support/stremio-server` no macOS; o supervisor deve usar diretório exclusivo por app via `APP_PATH` e `SETTINGS_PATH` (variáveis explicitamente suportadas, confirmadas no bundle).

Validação exploratória: o bundle iniciou com Node **24.19.0** do Linux, anunciou `127.0.0.1:11470` e localizou ffmpeg/ffprobe. Isso confirma execução com Node oficial sem o runtime x86_64 do Stremio, mas **não** certifica torrent/macOS ou aceleração; testes de perfil de transcodificação falharam neste container sem hardware correspondente. Reprodução nativa deve passar URL original ao mpv, evitando transcodificação e preservando MKV, HEVC, faixas e metadados HDR.


# Estudo: stremio-web, stremio-core e camada de vídeo

Consulta em 27/10/2026, leitura de código antes de implementação. Referências fixadas:

- `Stremio/stremio-web`: `8329565d17b75d2af8ba5822aa8059058a5d934e` (HEAD).
- `Stremio/stremio-core`: `029301839c863f2c7e5b7dcb5ca170d85280eda7` (HEAD).
- Dependência investigada para chegar aos endpoints efetivamente usados: `Stremio/stremio-video`: `1b04d4bb4cc49d8b62955c152fd3449ea6a6db63` (HEAD, pacote `@stremio/stremio-video` 0.0.103).

## stremio-web

Licença declarada em `package.json`: `gpl-2.0`; `LICENSE.md` contém GPL versão 2; README declara GPL-2.0. O parágrafo modelo “or any later version” no fim do texto padrão da licença, por si só, não comprova concessão GPL-2.0-or-later para todo o projeto. Para evitar ambiguidade de compatibilidade com o GPL-3.0 do Seraflix, usar como referência de arquitetura e protocolo, sem copiar sua UI React nem incorporar código GPL-2.0-only. A interface real permanecerá a do stremio-sera.

`src/routes/Player/Player.js:540` carrega o stream e repassa retomada, autoplay, configuração de hardware, máximo de canais (32 com surround, 2 sem), legendas, endereço do streaming server e `shellTransport`. `src/routes/Player/useVideo.js` cria a abstração `@stremio/stremio-video`: mensagens de comando (`load`, `unload`, extras), `setProp`, `observeProp`; eventos `propChanged`, `propValue`, `ended`, `error`, `implementationChanged`. Estado cobre tempo, duração, buffer, pause, volume, áudio, legendas embutidas/extras e fullscreen. `usePlayer.js` converte eventos de tempo/pausa/fim em ações do core para histórico e retomada.

A seleção efetiva do player não está implementada no stremio-web: é delegada à dependência `stremio-video/src/StremioVideo/selectVideoImplementation.js`. Prioridades: dispositivo Chromecast conectado; YouTube; `shellTransport` → `ShellVideo`; player específico da TV/HTML5 com servidor; player HTML5 direto para URL sem servidor. Aproveitar esse desenho de adaptador: no Seraflix `IS_MAC` escolhe ponte libmpv; TV/web mantêm caminho existente.

`useSubtitles.ts` distingue `embedded` e `external`, normaliza língua, considera preferências da sessão e globais e faixas previamente selecionadas. Manter a distinção na ponte em vez de converter toda legenda para HTML.

## stremio-core

`LICENSE.md`: MIT, copyright © 2019 SmartCode OOD. Reutilização de código permitida com conservação do aviso MIT se algum trecho for incorporado; nesta versão serve de referência para conversão de stream e metadados, sem trazer o core inteiro.

`src/types/resource/stream.rs:457` constrói proxy apenas quando `behaviorHints.proxyHeaders` e servidor estão disponíveis: `/proxy/<query d=origem & h=header:valor & r=header:valor>/<caminho original>?<query original>`. Requisições e respostas podem ganhar headers distintos. Preservar query e codificação; não registrar URLs de debrid/tokens em logs.

`stream.rs:532` transforma torrent em `/<infoHash>/<fileIdx>`, usando `-1` quando índice não informado; trackers são parâmetros `tr` e filtros de nome `f`. O próprio código avisa que a criação de torrent ainda fica no stremio-video. Sem servidor, YouTube/torrent/arquivos especiais não devem ser tratados como URLs comuns.

`src/models/player.rs:1579` solicita recursos de legendas dos addons usando `videoHash`, `videoSize` e `videoFilename`, vindos de behaviorHints ou dos parâmetros calculados pelo servidor. Aproveitar essa ordem de fallback e continuar usando API Stremio já presente no Seraflix; o mpv cuidará de faixas embutidas.

## Endpoints e comportamento real (stremio-video, MIT declarado no package.json)

A implementação dos endpoints procurados está principalmente nesta dependência:

- `src/withStreamingServer/buildProxyUrl.js`: monta `/proxy/` com `d`, `h`, `r`, caminho e query. Evita CORS e injeta headers; para libmpv deve preservar headers exigidos pelo provedor, via proxy ou opções nativas permitidas.
- `src/withStreamingServer/withStreamingServer.js:43`: `/hlsv2/probe?mediaURL=...` retorna formato e streams/codecs/canais. `canPlayProbe` exige container/codecs compatíveis, canais dentro do limite, ausência de legenda embutida e menos de duas faixas de áudio para o player HTML5. Se incompatível ou `forceTranscoding`, carrega `/hlsv2/<id>/master.m3u8?mediaURL=...&videoCodecs=...&audioCodecs=...&maxAudioChannels=...` (opcional `forceTranscoding=1`). Isso é fallback para limitações do navegador; mpv deve consumir mídia original sempre que suportada, preservando HEVC/4K/HDR e faixas.
- Legendas externas não ASS usam `/subtitles.vtt?from=<url>`; ASS usam proxy. ASS embutido pode vir de `/hlsv2/<id>/source/subtitle/<streamId>.ass?...` e fontes anexas de `/source/attachment/<id>`. O player nativo já entende ASS/fontes/PGS/SRT embutidos, sem extração/transcodificação obrigatória.
- `src/tracksData.js`: `http://127.0.0.1:11470/tracks/<encodeURIComponent(url)>`, separando tipos `audio` e `text`. É consumido pelos players Tizen/webOS. No Mac preferir a lista `track-list` do mpv para expor dados realmente disponíveis.
- `src/withStreamingServer/createTorrent.js`: usa URL simples quando há índice e nenhum tracker extra; nos outros casos `POST /<hash>/create` com `torrent.infoHash`, busca de peers e `guessFileIdx` (opcional temporada/episódio); usa resposta `guessedFileIdx`.
- `src/withStreamingServer/fetchVideoParams.js`: `/opensubHash?videoUrl=...`, estatísticas de torrent `/<hash>/<idx>/stats.json` ou `/<hash>/stats.json`, além de `/subtitleSignature?videoUrl=...` para preferência de legendas. Processa respostas independentes sem bloquear reprodução se falharem.
- `src/ShellVideo/ShellVideo.js` mapeia `paused→pause`, tempo em ms→segundos, áudio→`aid`, legenda→`sid`; envia `mpv-command`, `mpv-set-prop`, `mpv-observe-prop` e recebe alterações. Observa `track-list`, `paused-for-cache`, `cache-buffering-state`, `demuxer-cache-time`, `eof-reached`. Faz `loadfile` com assinatura ajustada à versão mpv >=0.39. Esse vocabulário informa nossa ponte fechada, documentada; não expor comandos arbitrários vindos de qualquer página.

Decisão: arquitetura inspirada nas referências e libmpv pela API pública; manter código novo GPL-3.0 compatível com stremio-sera e conservar avisos das dependências realmente distribuídas. Nenhuma conclusão sobre a licença de distribuição do `server.js` pode ser inferida da licença MIT do core ou do serviço; o binário/artefato precisa ser avaliado separadamente.

## Plano curto, riscos e ordem

1. **Estudo e plano** (este commit): licenças e decisões registradas; nenhum server.js redistribuído.
2. **Shell e UI**: AppKit/WKWebView, fallback produzido diretamente do repositório UI, cache local com manifesto SHA-256, commit main resolvido via API GitHub e arquivos do mesmo commit. Carregamento local imediato; atualização sem bloquear a primeira janela.
3. **Servidor**: Node nativo por arquitetura, bootstrap independente, download oficial validado de server.js na primeira execução, loopback 11470, health check, backoff, logs e desligamento.
4. **Ponte e player**: contrato fechado/versionado, libmpv render API OpenGL sob WKWebView transparente, VideoToolbox no M1/M3, faixas e eventos; menus, Now Playing e inibição de suspensão durante vídeo.
5. **Empacotamento e Actions**: binários arm64 e x86_64 separados para macOS 13+, dependências relocadas, assinatura ad hoc, DMG, Sparkle para releases, dispatch para fallback e PR isolado da UI.

Riscos: OpenGL não certifica HDR/EDR passthrough (tone mapping SDR inicial); primeira execução depende da fonte oficial do servidor; downloads de UI precisam snapshot íntegro e não podem executar ponte a partir de páginas arbitrárias; bibliotecas FFmpeg/mpv requerem avisos e fonte correspondente. Compilação e smoke test de macOS serão feitos em runner macOS se o GitHub permitir; login, debrid, torrent real, saída HDR e meta de <2 s exigem Mac e conteúdo acessíveis. Não declarar tais critérios atendidos sem medição.

A conexão GitHub desta sessão recusou criar o repositório novo (createRepository: Resource not accessible by integration). O trabalho segue localmente e o usuário foi informado para criar/habilitar o repo; isso também condiciona build remoto executável.
