# Ponte Seraflix — versão 1

Único contrato JS ↔ Swift. A UI continua em `stremio-sera/src`; o adaptador só é incluído no build Mac. TV/web continuam com HTML5/hls.js. Tempos são **segundos**, volume 0–100 e IDs de faixa são strings retornadas pelo mpv (não índices de ffprobe).

## Transporte

Somente o frame principal da UI local carregada do fallback/cache pode enviar:

```js
window.webkit.messageHandlers.seraflix.postMessage({
  version: 1, id: 'pedido-1', command: 'load',
  args: { url: 'https://exemplo/video.mkv', title: 'Filme', startTime: 30 }
});
window.addEventListener('seraflix-native', ({ detail: { event, data } }) => {
  // event === 'response': { id, ok, error? }
  // outros eventos são estado assíncrono
});
```

`response.ok` confirma aceitação do pedido; falhas posteriores do mpv chegam em `error`. Não há acesso a comandos arbitrários do mpv, scripts, filesystem ou execução de programas. URLs de mídia/legenda aceitam apenas HTTP(S). Navegações externas não ganham a ponte; links explícitos abrem no navegador padrão. Iframes não podem chamar o nativo. Não expor tokens/URLs de debrid em logs do shell.

## Comandos

| command | args | Efeito |
|---|---|---|
| `appReady`, `serverStatus` | `{}` | Emite estado atual do servidor |
| `load` | `{url,title?,startTime?}` | Substitui mídia, sem transcodificar |
| `play`, `pause`, `stop` | `{}` | Reprodução/pausa/encerramento |
| `seek` | `{position}` | Busca absoluta em segundos |
| `audio` | `{id}` | Escolhe faixa embutida |
| `subtitle` | `{id}` ou `{url,title?,lang?}` | Escolhe faixa (`'no'` desliga) ou carrega externa |
| `subtitleDelay` | `{value}` | Sincronia em segundos, -600 a 600 |
| `volume` | `{value}` | Volume 0–100 |
| `mute` | `{value:boolean}` | Mudo |
| `fullscreen` | `{}` | Alterna tela cheia AppKit |

## Eventos

| event | data |
|---|---|
| `response` | `{id,ok,error?}` |
| `loaded` | `{session}`; mídia pronta para busca/retomada |
| `time` | `{session,position,duration,paused,buffering,bufferEnd}`; até cerca de 4 Hz, também em mudanças de estado |
| `tracks` | `{session,audio:[{id,lang,title,selected}],subtitles:[...]}` |
| `state` | `{session,volume? (0–100),mute? (boolean)}` |
| `ended` | `{session,reason}`; fim natural distinto de troca/parada |
| `error` | `{session?,message}` |
| `server` | `{state,url,version?,message?}` |

Estados servidor: `stopped`, `installing`, `downloading`, `starting`, `ready`, `restarting`, `error`. Endpoint fixo `http://127.0.0.1:11470`. Após `ready`, a UI refaz `/settings`; não espera servidor para abrir a home. A sessão do player aumenta por `load`; a UI descarta eventos da sessão anterior quando aplicável.

Cmd+F e `fullscreen` passam pelo NSWindow, preservando a composição vídeo/controles. Teclas de mídia/Now Playing chamam os mesmos métodos e recebem o mesmo estado. A tela só é mantida acordada durante reprodução. `seraflix-open-url` é um evento local usado por Arquivo → Abrir endereço de vídeo, consumido pela UI para abrir seus controles normais.
