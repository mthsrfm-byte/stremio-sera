// Abertura do Seraflix: um filamento de luz acende, se abre em duas linhas e revela o logo; o
// "flix" entra fechando o espaçamento. Na saída, zoom atravessando o logo com faixas de luz
// passando pela tela. Som curto (clique seco + acorde suave) na revelação e um "whoosh" na saída,
// sintetizados aqui com Web Audio (sem arquivo de áudio e sem usar som de ninguém).
const MIN_MS = 2000;
const SOUND_AT_MS = 450; // quando as linhas se abrem e o logo aparece
const OUT_MS = 950;

// Faixas de luz da saída: posição, largura, cor e atraso fixos (mesma abertura sempre).
const RIBBON_COLORS = ['#3347FF', '#6E7BFF', '#A9B4F5', '#8A5CFF', '#FFFFFF', '#4C6BFF', '#C9BBFF'];

let started = 0;
let sound = false;

function ribbons(boot) {
  const box = boot.querySelector('.intro-ribbons');
  if (!box || box.firstChild) return;
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 34; i++) {
    const c = RIBBON_COLORS[i % RIBBON_COLORS.length];
    const el = document.createElement('i');
    el.style.left = (rnd() * 100).toFixed(1) + '%';
    el.style.width = Math.round(4 + rnd() * 36) + 'px';
    el.style.background = 'linear-gradient(to bottom, rgba(0,0,0,0), ' + c + ' 30%, ' + c + ' 70%, rgba(0,0,0,0))';
    el.style.boxShadow = '0 0 ' + Math.round(10 + rnd() * 22) + 'px ' + c; // brilho em volta: faixa de luz, não listra
    el.style.webkitAnimationDelay = el.style.animationDelay = Math.round(rnd() * 260) + 'ms';
    box.appendChild(el);
  }
}

export function play(withSound) {
  started = Date.now();
  sound = !!withSound;
  const boot = document.getElementById('boot');
  if (boot) {
    ribbons(boot);
    boot.classList.add('run');
  }
  if (withSound) setTimeout(playSound, SOUND_AT_MS);
  return new Promise((resolve) => setTimeout(resolve, MIN_MS));
}

// O app está pronto: atravessa o logo (zoom + faixas de luz) e remove a abertura do DOM.
export function finish() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  const wait = Math.max(0, MIN_MS - (Date.now() - started));
  setTimeout(() => {
    ribbons(boot);
    boot.classList.add('out');
    if (sound) playWhoosh();
    setTimeout(() => boot.parentNode && boot.parentNode.removeChild(boot), OUT_MS + 50);
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

// "Whoosh" da saída: ruído filtrado que sobe e some, com um grave curto por baixo.
export function playWhoosh() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  let ctx;
  try {
    ctx = new AC();
  } catch (e) {
    return;
  }
  if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + 0.02;
  const dur = 0.85;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.9;
  band.frequency.setValueAtTime(350, t0);
  band.frequency.exponentialRampToValueAtTime(2600, t0 + dur * 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22, t0 + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  noise.connect(band);
  band.connect(g);
  g.connect(ctx.destination);
  noise.start(t0);
  const boom = ctx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(90, t0 + dur * 0.55);
  boom.frequency.exponentialRampToValueAtTime(42, t0 + dur + 0.3);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.0001, t0 + dur * 0.55);
  bg.gain.exponentialRampToValueAtTime(0.35, t0 + dur * 0.62);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.35);
  boom.connect(bg);
  bg.connect(ctx.destination);
  boom.start(t0 + dur * 0.55);
  boom.stop(t0 + dur + 0.4);
  setTimeout(() => ctx.close && ctx.close().catch(() => {}), 2000);
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
