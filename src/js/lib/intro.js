// Abertura do Seraflix: o logo é revelado por uma linha azul que varre da esquerda para a direita,
// o "flix" sobe, um brilho pulsa e toca um som curto (clique seco + acorde suave), sintetizado
// aqui com Web Audio (sem arquivo de áudio e sem usar som de ninguém). Dura ~2,2 s; depois a tela
// de abertura some em fade quando o app estiver pronto.
import { IS_WEB } from './platform.js';

// Na web a abertura é mais curta (o CSS de src/web/web.css acompanha estes tempos).
const MIN_MS = IS_WEB ? 1700 : 2200;
const SOUND_AT_MS = IS_WEB ? 850 : 950; // quando a linha termina de revelar o logo

let started = 0;

export function play(withSound) {
  started = Date.now();
  const boot = document.getElementById('boot');
  if (boot) boot.classList.add('run');
  if (withSound) setTimeout(playSound, SOUND_AT_MS);
  return new Promise((resolve) => setTimeout(resolve, MIN_MS));
}

// O app está pronto: some a abertura (fade com leve zoom) e remove do DOM.
export function finish() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  const wait = Math.max(0, MIN_MS - (Date.now() - started));
  setTimeout(() => {
    boot.classList.add('out');
    setTimeout(() => boot.parentNode && boot.parentNode.removeChild(boot), 600);
  }, wait);
}

// Volta a mostrar a abertura parada (sem repetir a animação), ex.: depois de escolher o perfil.
export function showStatic() {
  const boot = document.getElementById('boot');
  if (boot) {
    boot.style.display = '';
    boot.classList.add('run', 'done');
  }
}

export function playSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  let ctx;
  try {
    ctx = new AC();
  } catch (e) {
    return;
  }
  if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
  synth(ctx, ctx.destination, ctx.currentTime + 0.03);
  setTimeout(() => ctx.close && ctx.close().catch(() => {}), 2500);
}

// O som em si (separado para dar para testar renderizando offline).
export function synth(ctx, out, t0) {
  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(out);

  // 1) Clique: rajada curtíssima de ruído filtrado (o "tic" de um botão físico).
  const len = Math.floor(ctx.sampleRate * 0.03);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 3200;
  band.Q.value = 1.2;
  const ng = ctx.createGain();
  ng.gain.value = 0.9;
  noise.connect(band);
  band.connect(ng);
  ng.connect(master);
  noise.start(t0);

  // 2) Corpo do clique: um "toc" grave que cai rápido de 220 para 90 Hz.
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(220, t0);
  thud.frequency.exponentialRampToValueAtTime(90, t0 + 0.07);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, t0);
  tg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.004);
  tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
  thud.connect(tg);
  tg.connect(master);
  thud.start(t0);
  thud.stop(t0 + 0.12);

  // 3) Acorde suave (Mi e Si, uma quinta), notas levemente defasadas, sumindo devagar.
  [
    { f: 659.25, at: 0.06, g: 0.16 },
    { f: 987.77, at: 0.12, g: 0.11 },
    { f: 1318.5, at: 0.18, g: 0.05 },
  ].forEach((n) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = n.f;
    const g = ctx.createGain();
    const s = t0 + n.at;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(n.g, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 1.4);
    o.connect(g);
    g.connect(master);
    o.start(s);
    o.stop(s + 1.5);
  });
}
