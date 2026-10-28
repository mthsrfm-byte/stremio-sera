# Validação da primeira versão

Atualizado em 28/10/2026. O usuário pediu para interromper a investigação da imagem preta no runner e entregar o pacote para validar no seu Mac M3. **A reprodução ainda não está certificada no hardware de destino.**

## Pacote

Código nativo `369119d`; commit de empacotamento `ac0a4b2`. Build final: [40607719952](https://github.com/mthsrfm-byte/stremio-sera/actions/runs/40607719952). O resultado de cada arquitetura está nos checks e artefatos desse run.

O workflow compila release arm64/x86_64, confere arquitetura e minOS≤13.0 dos Mach-O, verifica dependências locais, assina ad hoc e gera DMG, ZIP e SHA-256. O teste de reprodução é opcional nesta entrega, conforme o pedido do usuário; testes de cache, armazenamento WebKit e bootstrap continuam habilitados. Pode ser acionado com `run_smoke=true`, ou automaticamente com a variável `RUN_PLAYBACK_TESTS=true`.

O pacote não inclui `server.js`: baixa o artefato oficial e verifica SHA-256 na primeira abertura. Node, FFmpeg/ffprobe e player já estão no app, na arquitetura correspondente.

## Verificações aprovadas

- Estudo de fontes/licenças antes da implementação, commit `435fa66`.
- Builds TV/web comparados byte a byte com a referência anterior às alterações, fixando metadados e senha local de teste: nenhuma diferença.
- Build Mac da mesma UI sem gate de senha, com manifesto SHA-256; quatro testes do adaptador JS aprovados.
- Bootstrap: loopback, porta fixa 11470, recusa de porta alternativa e encerramento dos subprocessos.
- No macOS: 17 verificações do cache e quatro do armazenamento WebKit entre caminhos de UI/recriação da view. Não equivalem a login real ou teste após encerrar todo o processo; veja [cache-e-conta.md](cache-e-conta.md).
- Compilação, assinatura ad hoc e pacotes executados em Apple Silicon e Intel. A checagem de minOS não substitui execução física no macOS 13.
- O diagnóstico isolado [40606101818](https://github.com/mthsrfm-byte/stremio-sera/actions/runs/40606101818) reproduziu MPEG4, HEVC Main10 4K e vídeo sob WKWebView transparente, com pixels não pretos em FBO próprio da CAOpenGLLayer.

## Reprodução completa observada antes da entrega

A execução [40607157383](https://github.com/mthsrfm-byte/stremio-sera/actions/runs/40607157383), código `a5ccfc4`, rodou os três cenários no app arm64 real. A suíte global ficou vermelha; o resultado positivo do torrent não aprova todos os vídeos.

| Caso | Resultado |
|---|---|
| Torrent privado controlado | **Aprovado no app arm64:** servidor oficial iniciado pelo app, metadados, Range 206 com 64 KiB comparados à fixture, MKV HEVC 4K carregado, tempo avançando, pixels não pretos, áudio 2 e SRT 1 selecionados. |
| MPEG4 por HTTP local | Carregou e avançou, mas o teste não detectou imagem e terminou por timeout. |
| HEVC 4K por HTTP local | Carregou, avançou e selecionou faixas; o teste não detectou imagem e terminou por timeout. |
| Supervisão do servidor | Reinício após queda provocada confirmado nos casos HTTP, independentemente da falha de imagem. |

O servidor respondeu com versão interna 4.21.0; o download oficial fixado é rotulado `v4.21.1`. A home apareceu em 3,06 s, 2,14 s e 2,29 s nesses casos. A meta de menos de 2 s **não foi demonstrada**.

O runner usa **Apple Software Renderer**. Nesse caso o app escolhe `videotoolbox-copy`; no M1/M3 com GPU permanece `auto-safe`. Os logs confirmaram decode VideoToolbox, mas a saída do runner foi estéreo. Não certifica surround físico, fluidez, sincronia ou consumo no M3.

A fixture é um recorte de aproximadamente 4,2 s de Big Buck Bunny ampliado para 3840×2160, HEVC de 10 bits SDR, áudio sintético estéreo/5.1 e SRT de teste. Atribuição e receita: [ATTRIBUTION.md](../tests/fixtures/ATTRIBUTION.md). Não comprova original 4K de alto bitrate nem HDR.

Depois dessa execução foi corrigida a exigência de manter o contexto CGL correto em `mpv_render_context_update` (`369119d`). A reprodução dessa alteração fica para a validação no Mac, conforme solicitado; não há declaração de que resolveu os timeouts do runner.

## Validação pendente no Mac

- Abrir o DMG arm64, instalar o app e validar imagem/controles no M3.
- Login Stremio e link debrid MKV HEVC 4K com legenda embutida: conta/link reais não foram fornecidos.
- Torrent externo e reprodução prolongada; o teste aprovado usa um seeder local controlado.
- Startup <2 s, GPU, energia, sincronia prolongada, teclas de mídia físicas e saída multicanal.
- HDR/EDR passthrough e Dolby Vision não estão implementados/certificados; o caminho inicial usa tone mapping SDR.
- Atualização visual pela main após integrar/publicar o PR da UI. O fallback usa a branch do PR; o validador de snapshots foi testado, mas uma mudança visual publicada na main ainda não foi acompanhada ponta a ponta.
- Sparkle exige chave Ed25519 e appcast. A versão ad hoc sem chave mantém atualizações nativas automáticas desabilitadas.
- Distribuição pública requer revisar as fontes correspondentes do perfil binário IINA: [dependencies.md](dependencies.md). Assinatura ad hoc não é notarização Apple.

## Publicação

A integração GitHub recusou a criação de `mthsrfm-byte/stremio-sera-mac` (403). O projeto novo está pronto localmente, com histórico por etapa. Para compilar e entregar o executável, o histórico foi publicado na branch **isolada** [build/seraflix-mac-0.1](https://github.com/mthsrfm-byte/stremio-sera/tree/build/seraflix-mac-0.1) do repositório existente. Ela não deve ser integrada à UI e não substitui a criação do repositório novo. O PR da plataforma é separado: [#51](https://github.com/mthsrfm-byte/stremio-sera/pull/51).
