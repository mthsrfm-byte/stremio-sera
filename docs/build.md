# Compilar e instalar

Requisitos de desenvolvimento: Mac Apple Silicon ou Intel, macOS 13+, Xcode Command Line Tools/Swift 5.9+, Node 22+, npm, Python 3 e pkg-config (`brew install pkgconf`). O usuário final recebe um app autocontido e não precisa instalar essas ferramentas.

```sh
scripts/build.sh
open build/$(uname -m)/Seraflix.app
```

O script busca a `main` de `mthsrfm-byte/stremio-sera`, executa `npm ci` e `npm run build:mac`, valida o manifesto SHA-256 e incorpora apenas `site/mac/` como fallback. Para testar o PR da plataforma antes do merge:

```sh
UI_REF=feat/mac-platform scripts/build.sh
```

`UI_REF` também aceita SHA completo. `UI_SOURCE=/caminho/stremio-sera` permite usar checkout local. Fontes temporárias ficam somente em `.build/ui-repository`, ignorado pelo Git; o repositório Mac não copia nem mantém `src/` da UI.

São gerados `build/arm64/Seraflix.app` e `artifacts/Seraflix-0.1.0-arm64.dmg` (ou `x86_64` no Intel), além do ZIP e SHA256SUMS. No M1/M3 use arm64: player, Node e helpers são executados nativamente, sem Rosetta. Cada pacote valida todas as dependências Mach-O e recusa qualquer minOS maior que 13.0. VideoToolbox é habilitado para HEVC; desempenho e consumo devem ser medidos em hardware real.

Para instalar, monte o DMG e arraste Seraflix para Aplicativos. A primeira versão tem assinatura ad hoc e não é notarizada: no Finder, clique com o botão direito no app, escolha Abrir e confirme. Atualizações assinadas por Developer ID/notarizadas exigem credenciais Apple do mantenedor.

## Dependências e fontes

O modo padrão (`DEPS_MODE=binary`) usa snapshot oficial IINA validado por SHA-256 para desenvolvimento, com todos os limites descritos em `docs/dependencies.md`. O FFmpeg/ffprobe é compilado das fontes oficiais, sem dependências Homebrew, com deployment target 13.0. Node 22.22.2 é oficial e o checksum é fixado por arquitetura. O script nunca incorpora `server.js`; o app baixa da fonte oficial na primeira execução.

Para obter uma release com a associação exata entre bibliotecas e fontes:

```sh
brew install meson ninja cmake pkgconf automake nasm
DEPS_MODE=source scripts/build.sh
```

Esse modo compila as bibliotecas via receita IINA fixada e guarda fontes/receita/logs junto dos artefatos. A compilação pode ser longa. Tags usam obrigatoriamente esse modo e criam somente uma release draft; a publicação depende de revisão dos avisos e fontes correspondentes.

## Actions e atualização do fallback

`build.yml` compila em `macos-latest` (arm64) e `macos-15-intel`, gera app/DMG, valida minOS/assinatura e executa smoke test com WKWebView e vídeo servido por HTTP local. Os artefatos ficam no run por 30 dias. Login Stremio, debrid, torrents reais e saída HDR não são cobertos pelo smoke test.

`refresh-ui.yml` recebe `repository_dispatch` tipo `ui-updated` com `client_payload.ui_commit` e atualiza apenas `Resources/fallback`. O push pelo GITHUB_TOKEN não inicia outro build. No `stremio-sera`, configure `MAC_DISPATCH_TOKEN` com acesso de escrita a este repositório para enviar o evento. Não há token de GitHub dentro do app. O bundle remoto de UI continua atualizado independentemente de releases nativas.

## Sparkle

Sparkle 2.10.1 está vinculado ao app. Para habilitar verificações automáticas, configure `SPARKLE_PUBLIC_KEY` (variável de Actions ou ambiente) com a chave pública Ed25519. O build grava `SUPublicEDKey` e usa feed separado por arquitetura: `https://mthsrfm-byte.github.io/stremio-sera-mac/appcast-arm64.xml` / `appcast-x86_64.xml`.

Gere o par de chaves com `generate_keys` da distribuição oficial Sparkle e configure `SPARKLE_PRIVATE_KEY` como secret de Actions. Em tags com build das fontes, `scripts/generate-appcast.sh` baixa as ferramentas Sparkle 2.10.1 (SHA-256 fixado), assina o ZIP e gera `appcast-arm64.xml` / `appcast-x86_64.xml` nos artefatos e na release draft. Publique os XML no GitHub Pages configurado e os ZIP na release após revisão; o workflow não publica Pages automaticamente. A chave privada deve ficar somente no secret do mantenedor; não entra no app/repositório. Sem chave pública, verificações automáticas ficam desabilitadas para evitar feeds sem assinatura. O menu de atualização informa essa configuração.
