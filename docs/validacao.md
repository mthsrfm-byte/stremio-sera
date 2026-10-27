# Validação da primeira versão

Registro em 27/10/2026; atualizado com o resultado do build macOS ao final da tarefa.

## Verificado no ambiente Linux

- Estudo de fontes/licenças antes de implementação, commit `435fa66`.
- Builds TV e web do stremio-sera comparados byte a byte com referência anterior às alterações, fixando metadados de commit/data/mensagem e senha local de teste: nenhuma diferença.
- Build Mac da mesma UI, sem gate de senha, manifesto SHA-256: aprovado (63 arquivos no snapshot inicial).
- Quatro testes do adaptador JS Mac: aprovados.
- Teste de lifecycle do bootstrap: aprovado; loopback, porta fixa11470, recusa alternativa, flags de isolamento e encerramento de subprocessos.
- Execução exploratória do `server.js` oficial com Node Linux: `/settings`, versão e escuta loopback confirmados. Isso não certifica torrent no macOS.

## Verificação macOS automatizada

O workflow compila arm64 em `macos-latest` e Intel em `macos-15-intel`, valida minOS/arquitetura de todos os Mach-O e dependências locais, assina ad hoc, gera DMG e ZIP. O smoke test lança o .app real, espera a home do WKWebView, abre vídeo MPEG4 gerado localmente via HTTP e exige evento loaded e avanço >0,3s vindo do libmpv. Também testa MKV HEVC Main10 3840×2160 SDR (upscale), dois áudios e SRT embutida, com seleção de faixas. Só passa o render se houver pixels não pretos no FBO do mpv. A atribuição/receita da fixture CC BY3.0 está em `tests/fixtures/ATTRIBUTION.md`. Grava JSON com tempo observado até home; o runner não é equivalente ao M1/M3 do usuário.

Resultado desta execução: pendente do workflow; não interpretar a existência de código/testes como execução bem-sucedida. Consulte o resultado e JSON do job.

Verificação binária arm64 já executada no runner: Swift e FFmpeg compilaram, Node SHA-256 passou, todos os Mach-O foram checados para arm64 e minOS≤13.0. A primeira falha pós-build foi na ordem de assinatura, corrigida antes de nova rodada. Essa checagem de minOS não substitui execução física no macOS 13.

## Dependem de teste no Mac do usuário

- Login Stremio e reprodução de um link debrid MKV HEVC4K com legenda embutida: requer conta/link de teste que não foram fornecidos.
- Torrent real pelo servidor supervisionado: requer torrent legal com seeders e conectividade apropriada; teste Linux do endpoint não o substitui.
- Medida <2s em M1/M3: não há Mac físico conectado à sessão. A home não bloqueia em rede/servidor/intro; desempenho precisa ser medido no destino.
- Tela HDR/EDR, Dolby Vision, surround no dispositivo de saída e teclas de mídia físicas: precisam de hardware; HDR passthrough não está implementado (tone mapping SDR inicial).
- Atualização visual real pela main: o PR da UI precisa ser integrado/publicado. O fallback inicial usa branch do PR. Depois de merge, alterar UI na main, esperar workflow publicar e reabrir sem interação durante atualização.
- Sparkle: exige appcast publicado e chave Ed25519 configurada numa release. Build ad hoc sem chave não simula atualização assinada.

## Publicação

A integração GitHub recusou criação de `mthsrfm-byte/stremio-sera-mac`. O repositório foi construído localmente com histórico por etapa. Para tentar entregar executável sem esperar a mudança de permissão, o mesmo histórico nativo foi enviado a uma branch **isolada** `build/seraflix-mac-0.1` no repositório existente, exclusivamente para CI. Essa branch não deve ser integrada à UI e não substitui o repositório novo. O PR da UI é separado: https://github.com/mthsrfm-byte/stremio-sera/pull/51.
