# Seraflix para Mac

Shell nativo **AppKit + WKWebView + libmpv**, macOS 13+, Apple Silicon (M1 mínimo; M3 recomendado) e Intel. A interface é a do [stremio-sera](https://github.com/mthsrfm-byte/stremio-sera): não existe cópia de `src/` neste repositório. O fallback contém somente seu resultado de build.

Esta é a primeira versão de desenvolvimento, assinada **ad hoc**, sem notarização Apple. Veja [validação](docs/validacao.md) para os testes realmente executados e limitações.

A integração GitHub recusou a criação de `mthsrfm-byte/stremio-sera-mac` (403). O projeto novo está pronto localmente; para entregar o executável, o mesmo histórico foi publicado temporariamente na branch [build/seraflix-mac-0.1](https://github.com/mthsrfm-byte/stremio-sera/tree/build/seraflix-mac-0.1) do repositório existente. Essa branch é exclusiva do app nativo e não deve ser integrada à UI. O PR da plataforma Mac permanece separado.

## Instalar

Baixe o artefato `Seraflix-arm64` nos [Actions desta entrega](https://github.com/mthsrfm-byte/stremio-sera/actions/runs/40607719952) para seu M1/M2/M3/M4; `Seraflix-x86_64` é para Intel. Abra o DMG e arraste **Seraflix.app** para Aplicativos. Como a assinatura é ad hoc, use Abrir pelo menu de contexto ou Ajustes do Sistema → Privacidade e Segurança → Abrir Mesmo Assim caso o Gatekeeper peça. Não é necessário instalar Homebrew, Node nem Stremio no Mac do usuário.

Na primeira abertura, o app baixa o streaming server oficial em segundo plano, verifica SHA-256 e o inicia. A home não espera esse download. Se o Stremio/Stremio Service já estiver aberto, feche-o para liberar `127.0.0.1:11470`; o Seraflix não encerra processos de outros apps. Estado e erros aparecem na UI. A conta, addons e biblioteca continuam sendo os da interface original; não forneça suas credenciais em issues ou logs.

O menu **Arquivo → Abrir endereço de vídeo…** (Cmd+O) permite testar um HTTP(S) ou magnet com os mesmos controles Seraflix. Cmd+F alterna tela cheia nativa, Cmd+W fecha a janela e Cmd+Q encerra app e servidor. Copiar/colar, teclas de mídia, Now Playing e prevenção de repouso durante reprodução são nativos.

## O que é nativo e o que é web

| Parte | Implementação |
|---|---|
| Home, busca, conta, addons, biblioteca e controles de reprodução | UI compartilhada do stremio-sera |
| Janela, menus, tela cheia, teclas de mídia, Now Playing | Swift/AppKit/MediaPlayer |
| MKV, HEVC, áudio multicanal e faixas embutidas | libmpv, VideoToolbox, CoreAudio e libass |
| Torrents, proxy de headers, metadados/legendas pelo servidor | Node + streaming server Stremio supervisionado |
| Atualizações do binário | Sparkle, quando a release tiver chave Ed25519 configurada |

No Apple Silicon, executável, Node e helpers são arm64; as bibliotecas são verificadas/extraídas para a mesma arquitetura. Não há Rosetta na versão arm64. Decodificação `hwdec=auto-safe` permite VideoToolbox para HEVC suportado pelo hardware e fallback para outros codecs. Saída surround depende do dispositivo/rota de áudio; trocar faixas não requer transcodificar o vídeo.

Se o contexto OpenGL só oferecer um renderer de software, o app usa `videotoolbox-copy` para evitar compartilhar superfícies de hardware com esse renderer. O decode continua no VideoToolbox; essa cópia adicional não é habilitada no caminho com GPU do M1/M3.

**HDR:** nesta versão a composição do vídeo usa render API OpenGL, com tone mapping para SDR. Saída HDR/EDR passthrough e Dolby Vision não estão certificadas. Implementar Metal/EDR e medir numa tela compatível é trabalho posterior. Não se deve confundir decodificar HEVC HDR com entregar HDR na tela.

## Como a UI acompanha a main

O [PR da plataforma Mac](https://github.com/mthsrfm-byte/stremio-sera/pull/51) acrescenta `npm run build:mac` → `site/mac/` no repositório original, sem tranca de senha. O workflow `mac-ui.yml` publica esse resultado com um manifesto: versão da ponte, commit de origem e SHA-256 de cada arquivo.

Em cada abertura, o shell mostra imediatamente cache/fallback, resolve `main` pela API GitHub e baixa `site/mac` de **um único commit imutável** no jsDelivr (com fallback à fonte oficial raw.githubusercontent.com). Só troca o snapshot após todos os hashes conferirem. Se não houve interação, aplica a atualização nessa abertura; se o usuário já começou a navegar ou entrar na conta, guarda para a próxima, evitando interromper o uso. Sem rede, com limite da API ou erro de download, conserva a versão local. TLS + resolução do commit + hashes garantem consistência do snapshot; não são uma assinatura independente do mantenedor.

Enquanto o PR não for integrado, a `main` ainda não publica o build Mac. O primeiro fallback foi compilado da branch do PR, identificada em `Resources/ui-source-commit.txt`; nenhuma cópia da UI foi reescrita aqui. Depois do merge, basta a próxima publicação `mac-ui.yml` para liberar a atualização automática real.

O `repository_dispatch` `ui-updated` só regenera/commita o fallback; não dispara rebuild do código nativo. Para ativá-lo, configure no **stremio-sera** o secret `MAC_DISPATCH_TOKEN`, com acesso ao **stremio-sera-mac** e permissão de contents write para repository_dispatch. O token não entra no app. Sem esse secret, a atualização online da UI segue funcionando; o fallback é atualizado manualmente pelo workflow. Alterações nativas exigem novo release.

## Compilar no Mac

Requer Xcode/Command Line Tools, Swift, Node/npm, Python 3 e `pkg-config` (`brew install pkgconf`).

```sh
git clone https://github.com/mthsrfm-byte/stremio-sera-mac.git
cd stremio-sera-mac
./scripts/build.sh
```

Enquanto o repositório novo não estiver disponível, obtenha o projeto com `git clone --single-branch --branch build/seraflix-mac-0.1 https://github.com/mthsrfm-byte/stremio-sera.git stremio-sera-mac`.

Antes do merge do PR da UI, use `UI_REF=feat/mac-platform ./scripts/build.sh`. O script busca o fonte original numa pasta de build ignorada, executa `build:mac`, embute fallback, Node, helpers e bibliotecas, corrige install names, valida arquitetura/minOS, assina ad hoc e gera `.app`, `.zip` e `.dmg`. O Mac de destino não depende de caminhos Homebrew. Os pacotes por arquitetura evitam carregar código Intel no seu M3. Detalhes, dependências fixadas e perfis de distribuição em [docs/build.md](docs/build.md) e [docs/dependencies.md](docs/dependencies.md).

Para release Sparkle: configure `SPARKLE_PUBLIC_KEY`/chave privada de assinatura, publique appcasts por arquitetura e arquivos assinados conforme as instruções de build. A versão ad hoc sem chave não tenta instalar atualizações nativas não assinadas. A chave Apple Developer/notarização é opcional para compilação ad hoc, mas necessária para uma distribuição sem os avisos usuais do Gatekeeper.

## Servidor e licença

O shell/UI são GPL-3.0. [docs/estudo.md](docs/estudo.md) registra fontes, commits e licenças de todos os projetos estudados. Não foi copiado código do shell-ng sem licença nem código GPL-2.0-only dos wrappers para o shell Swift.

**Não redistribuímos `server.js` no .app.** O bundle contém uma declaração MIT, mas o aviso completo `server.js.LICENSE.txt` indicado pelo cabeçalho não estava disponível na fonte oficial (404). Isso não permite afirmar que todas as dependências podem ser redistribuídas. O app baixa diretamente de `https://dl.strem.io/server/v4.21.1/desktop/server.js` na primeira execução; SHA-256 aprovado `405eb494d6708406a30e716c3cfb5abae7a5e9c7a8b79446d64c3f821385930f`. Alteração desse artefato exige revisão/hash novo em release nativa; não executamos conteúdo diferente silenciosamente.

O servidor fica em `~/Library/Application Support/Seraflix/Server`, a UI em `~/Library/Application Support/Seraflix/ui` e logs rotacionados em `~/Library/Logs/Seraflix`. O bootstrap fixa loopback/porta11470 e desativa HTTPS12470/casting. Há trava de instância, verificação HTTP, reinício com backoff e encerramento dos subprocessos no fechamento. O servidor de terceiros pode registrar URLs/tokens; revise e remova dados privados antes de compartilhar logs.

libmpv/FFmpeg e bibliotecas têm licenças próprias, incluídas no bundle quando disponíveis e relacionadas em [docs/dependencies.md](docs/dependencies.md). O perfil de dependências binárias do IINA é para validação técnica, com ressalva sobre correspondência exata de fontes. Não publicar release pública com esse perfil sem resolver essa correspondência; o caminho de build a partir das fontes registra receitas/fontes para distribuição.

A persistência da conta entre caminhos de UI está descrita e testada em [docs/cache-e-conta.md](docs/cache-e-conta.md).

Contrato único da ponte: [docs/bridge.md](docs/bridge.md). Resultados e pendências: [docs/validacao.md](docs/validacao.md).
