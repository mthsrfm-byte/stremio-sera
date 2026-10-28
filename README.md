# Seraflix

**O Stremio do jeito que eu queria ver na TV.** 🍿

O Seraflix é uma releitura do [Stremio](https://www.stremio.com/) para TVs Samsung (Tizen),
inclusive as mais antigas (2017 em diante, Tizen 3.0+) que não rodam o app oficial. Não é um
Stremio novo: é um **remix**. Peguei projetos abertos que já existiam, juntei, ajustei e fui
mexendo até ficar com a minha cara, pensando em três coisas:

- **Usabilidade de sofá.** Tudo no controle remoto da Samsung, sem ponteiro, com atalhos nas teclas
  coloridas, no play/pause e no avançar/voltar. Dá até para usar o celular como controle.
- **Organização.** Início, Recomendado e Streamings separados, fileiras que fazem sentido
  (em alta, chegou nos streamings, aclamados, true crime…), fontes de vídeo arrumadas com as
  diretas (debrid) primeiro e etiquetas de 4K, HDR e Dolby Vision.
- **Conteúdo adulto no lugar dele.** Os addons +18 ficam numa aba própria, organizada por site,
  com favoritos e "continuar assistindo" separados. Nada disso aparece misturado com o resto do app.

> **Não oficial.** Sem ligação com o Stremio, o Stremio Kai ou a Samsung. O app não hospeda nenhum
> conteúdo: ele só mostra o que os addons da **sua** conta do Stremio entregam.

![Tela inicial](docs/screenshot-home.png)

## O que tem

- **Sua conta do Stremio.** Entra com um código (no celular, em link.stremio.com) ou com e-mail.
  Addons, biblioteca e "Continuar assistindo" vêm da sua conta, e o progresso volta para ela.
- **Cara de cinema.** Banner rotativo com trailer, tema escuro ou OLED, notas do IMDb e do Rotten
  Tomatoes, sinopse e elenco com foto.
- **Player que se vira.** Usa o player da própria TV (H.264, HEVC, HDR10), pula abertura e
  encerramento, escolhe legenda sozinho, emenda o próximo episódio na mesma fonte e reconecta se o
  vídeo travar.
- **Perfis.** Tela de "Quem está assistindo?", cada perfil com a sua conta do Stremio.
- **Leve.** JavaScript simples, compilado para o navegador antigo das TVs; nada de WebAssembly.
- **Se atualiza sozinho.** Cada mudança aqui no repositório chega na TV na próxima vez que o app abrir.

## Do que você precisa

- Uma TV Samsung com **Tizen 3.0 ou mais novo** (2017 em diante). Testado numa UN50AU7700 de 2021 (Tizen 6.0).
- Para assistir, **um** destes:
  - um serviço **debrid** (Real-Debrid, AllDebrid etc.) nos addons do Stremio: toca direto na TV;
  - o [stremio-service](https://github.com/Stremio/stremio-service/releases) rodando num computador
    na mesma rede, para torrents (a TV não consegue rodar o motor de torrent sozinha).

## Instalando na TV

O jeito mais fácil é o **[SerafimFlix+](https://github.com/mthsrfm-byte/tizenbrew-sera)**, o
lançador que já vem com o Seraflix e o YouTube sem anúncios. No Mac, baixe o
[instalador](https://github.com/mthsrfm-byte/tizenbrew-sera/releases/latest/download/Instalar-SerafimFlix-Mac.zip),
abra com o botão direito → **Abrir** e vá respondendo: ele acha a TV, confere o Modo Desenvolvedor
e instala.

Já tem o [TizenBrew](https://github.com/reisxd/TizenBrew)? Então é só adicionar o módulo do GitHub:

```
mthsrfm-byte/stremio-sera
```

### Primeira vez abrindo

1. Ele pergunta pelo **servidor de torrent**. Se você usa debrid, escolha **Pular**. Para torrents,
   abra o [stremio-service](https://github.com/Stremio/stremio-service/releases) num computador da
   mesma rede e escolha **Procurar na rede**.
2. Entre na sua conta do Stremio: no celular, vá em **link.stremio.com** e digite o código da TV.
3. Seus addons e sua biblioteca carregam. Escolha algo e dá o play.

### Deu ruim?

- **O app não abre:** confira se o Modo Desenvolvedor continua **ligado** com Host PC IP
  **127.0.0.1**. Atualização de firmware ou reset de fábrica desligam isso.
- **Um vídeo não toca:** tente uma fonte direta (debrid) ou confira se o stremio-service está
  aberto no computador, no caso de torrents.

---

*Daqui para baixo é a parte técnica, para quem quer mexer no código.*

## Phone remote

The Seraflix module ships a TizenBrew service (`remote/tv-service.js`, `serviceFile` in
`package.json`). It starts when Seraflix opens and serves a phone remote at
`http://TV-IP:8090` (same Wi-Fi). The service forwards keys and text to the TV's own remote-control
WebSocket on `127.0.0.1:8002`, so the phone needs no certificate and it works on iPhone. The first
time, the TV asks to allow "Seraflix Controle"; the token is saved in
`/home/owner/share/seraflixRemote.json`. On its first run the service also adds Seraflix to
TizenBrew's `autoLaunchServiceList`, so from then on just opening TizenBrew (or the TV prelaunching
it) starts the remote, without opening Seraflix.

The remote also has **Mandar para a TV** (search icon): it searches the public Stremio catalog
(Cinemeta) on the phone and sends the pick to the TV (`POST /api/open`). Seraflix polls
`/api/pending` every few seconds and opens that title (movies open straight on the sources list).

`GET /api/info` reports the TV's Node.js version, memory and CPUs, to judge whether a torrent
engine could run on the TV itself.

On the TV, **Ajustes → Controle no celular → Abrir o controle no celular** shows a QR code with that
address (the service reports the TV's IP at `/api/ip`). `https://mthsrfm-byte.github.io/stremio-sera/controle/`
(the `remote/` folder on GitHub Pages) asks for the TV's IP and opens `http://TV-IP:8090`.

The page is locked with a 6-digit PIN (only its SHA-256 is in the code). After the right PIN the
device stays unlocked (cookie renewed on every visit + localStorage). To lock every device again,
change `AUTH_VERSION` in `remote/index.html`.

## Recomendado tab

Rows built from TMDB (needs the TMDB key): **Em alta agora** (this week's trending releases from the
last 6 months, already out), **True crime** (documentary films and series with the "true crime"
keyword, best rated first), **Suspense** and **Terror** (popular, well-rated movies). Resting on a
title shows its art and synopsis at the top; after 3 seconds the YouTube trailer plays there
(shown only after it has played smoothly for 2 s, which hides YouTube's low-resolution start and
start-up controls, then faded in with the audio ramping up; a spinner shows if it stalls later; on an error, or if it does not start within 8 s, it
tries the next one, up to 4, then gives up and keeps the art). Trailers start muted (browsers let
muted video autoplay) and unmute once playing; if unmuting pauses it, they keep playing muted. On
error 152/153 the same trailer is retried on youtube.com. **Ajustes → Sobre e depuração → Último
trailer** shows what happened with the last one. Ads: the official studio trailers are
preferred, which rarely carry ads; TizenTube's ad blocking can't be reused because it is injected
into youtube.com, and the trailer is a cross-origin YouTube iframe.
**Ver tudo** at the end of each row opens the whole category (Recomendado › Suspense) with
"Carregar mais".

## Streamings tab

A rail of service logos sits under the top bar (Netflix, Prime Video, Disney+, HBO Max, Apple TV+,
Paramount+, Globoplay, MUBI, Crunchyroll). Moving across it switches to that service's own home:
**Novidades** (recent releases), **Filmes** and **Séries** (the whole catalogue on the service's
subscription in Brazil, most popular first; **Ver tudo** pages through all of it) and **Aclamados**.

## Início

With the TMDB key, the home rows are picked from TMDB instead of the add-ons' generic catalogues:
Filmes em alta, Séries em alta, Chegou nos streamings, Aclamados do último ano, Séries obrigatórias
and Clássicos modernos, each with **Ver tudo**. Without the key it falls back to the add-on
catalogues, leaving out channels (YouTube), TV and public-domain movies.

Images never show half-loaded: posters, episode thumbnails, cast photos and service logos show a
shimmering skeleton until the image is fully loaded, then fade in.

## Ratings and subtitles

- Ratings show only IMDb (with its logo) and Rotten Tomatoes in one badge: critics on the left of
  the tomato, audience on the right, `--` when one is missing (from MDBList).
- Subtitles default to Bricolage Grotesque with their own typesetting: 90% size, weight 600,
  slightly open letter and word spacing, 1.18 line height, ~40-character lines and a soft halo
  instead of a hard outline. Figtree is offered as a free alternative close to Disney+'s (licensed)
Avenir.

## Opening

On launch, a thin blue line sweeps across and reveals the Serafim logo, "flix" rises and a soft glow
pulses (about 2.2 s), then the opening fades out over the ready home screen. A short sound plays
with it: a dry click plus a soft fifth (E and B), synthesized with Web Audio in `src/js/lib/intro.js`
(no audio file). **Ajustes → Aparência → Som de abertura** turns it off.

## Tizen integration

- Samsung **Return**, media, colour and channel keys, registered through the Tizen
  TVInputDevice API.
- Exits through the Tizen application API.
- Finds the TV's IP address (to scan the network for stremio-service) through Samsung's
  network API, with a WebRTC fallback.
- Shows the TV model in Settings through Samsung's product info API.
- Updates through TizenBrew.

## Known limitations

- **Audio and embedded subtitle tracks.** Switching them needs Samsung's native player (AVPlay),
  but apps that run inside TizenBrew have no access to the Tizen/Samsung web APIs (`tizen`,
  `webapis`). So Seraflix plays with the TV's HTML5 player: embedded subtitles only work when the
  file is fully downloaded on the PC (the server extracts them). Using AVPlay would require
  packaging Seraflix as a signed Samsung app (certificate from Tizen Studio tied to the TV).
- The AI enhancements of the PC version of Stremio Kai (SVP, VapourSynth, Anime4K) are not
  included: TVs can't run them.

## TMDB and MDBList keys

The app can ship with API keys built in, so nobody has to type them on the TV. Add them as
repository secrets (**Settings → Secrets and variables → Actions → New repository secret**):

- `TMDB_API_KEY`: TMDB API key (v3), free at themoviedb.org → Settings → API.
- `MDBLIST_API_KEY` (optional): free at mdblist.com → Preferences → API.

The **Build e publicar na TV** workflow embeds them in `dist/app.js`. The repository is public, so
the keys are readable by anyone. A key typed in Ajustes on the TV takes priority.

## Versão web (privada, GitHub Pages)

O mesmo app roda num navegador, em `https://mthsrfm-byte.github.io/stremio-sera/`, atrás de uma
senha. O workflow **Publicar site no GitHub Pages** (`.github/workflows/pages.yml`) publica a cada
push na main:

- `/`: o Seraflix para navegador (`npm run build:web`, saída em `site/app/`).
- `/controle/`: o controle pelo celular (pasta `remote/`).

Para ativar, crie o segredo **`WEB_PASSWORD`** (Settings → Secrets and variables → Actions). Sem ele o
build web para de propósito, para o app não ficar aberto. Só o hash salgado da senha vai para o site.
Para deslogar todos os aparelhos, troque `AUTH_VERSION` em `src/web/gate.js`.

Limites da versão web:

- **Não é privada de verdade.** O GitHub Pages só restringe o acesso a sites com GitHub Enterprise
  Cloud. Aqui a senha só barra quem chega na página; o código do app continua público no repositório.
- Trechos que só existem na TV ficam escondidos: atualização pelo TizenBrew, controle pelo celular e
  o "Sair" do Voltar.
- Torrents e fluxos HLS do stremio-service precisam de um player com suporte a HLS (o Chrome não toca
  HLS nativo). Fontes diretas (debrid, MP4/MKV) funcionam.
- O layout é o da TV (1920×1080). Funciona com mouse e teclado no computador; no celular fica pequeno.

## Building

Needs Node.js.

```
npm install
npm run build          # pacote da TV: dist/
npm run build:web      # site web: site/app/ (exige KAI_WEB_PASSWORD)
```

The built app is written to `dist/`, which TizenBrew loads (`appPath` in `package.json`).

## Fontes do remix

O Seraflix existe porque essas pessoas abriram o código delas. Valeu demais! 💙

- [Stremio](https://www.stremio.com/): o original, com a conta, os addons e todo o ecossistema.
- [Stremio Kai](https://github.com/allecsc/Stremio-Kai), de allecsc: o visual e boa parte das ideias.
- [Stremio Kai Timeworn](https://github.com/creachec/Stremio-Kai-Timeworn), de binhoc: a versão
  leve para TV que serviu de base para esta.
- [TizenBrew](https://github.com/reisxd/TizenBrew), de reisxd: o que faz o app rodar nas TVs Samsung.

## Licença

[GPL-3.0](LICENSE), a mesma dos projetos em que ele se baseia.

### Plataforma Mac

`npm run build:mac` gera `site/mac/` com a mesma UI e o mesmo palco da versão desktop,
sem a tranca de senha do site. O shell nativo está em
[mthsrfm-byte/stremio-sera-mac](https://github.com/mthsrfm-byte/stremio-sera-mac).
No Mac, o libmpv recebe a mídia pela ponte `WKScriptMessageHandler`; os controles,
menus, conta, addons e histórico continuam neste projeto. O contrato da ponte fica
em `docs/bridge.md` no repositório do shell.

O workflow `mac-ui.yml` publica somente o bundle gerado em `site/mac` e seu
`manifest.json` (commit de origem, versão da ponte e SHA-256 de cada arquivo).
O shell consulta a main, baixa por SHA imutável e valida os hashes; mantém cache
local e um fallback embutido para quando estiver offline. A atualização nativa é
separada, por release do app. Para também renovar esse fallback automaticamente,
configure `MAC_DISPATCH_TOKEN`: token GitHub com permissão **Contents: write**
somente em `stremio-sera-mac`, usado para `repository_dispatch` do tipo `ui-updated`.
A UI remota funciona mesmo sem esse segredo.

Os ramos exclusivos do Mac usam `__KAI_MAC__` para seleção em tempo de build;
`IS_MAC` também é exportado por `platform.js`. O build remove esses ramos antes de
empacotar TV/web para preservar integralmente os bundles anteriores. `IS_WEB`
continua identificando os comportamentos desktop (mouse, teclado e palco em pé),
também usados pelo Mac. O alvo da TV continua Chromium 38. Testes da adaptação:
`node --test tests/mac-player.test.mjs`.
