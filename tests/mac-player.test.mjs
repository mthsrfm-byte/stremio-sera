import test from 'node:test';
import assert from 'node:assert/strict';
import { createMacVideo } from '../src/js/lib/mac-player.js';

class Element extends EventTarget {
  constructor() { super(); this.attributes = new Map(); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) || null; }
  removeAttribute(key) { this.attributes.delete(key); }
}
function setup() {
  const messages = [];
  globalThis.window = new EventTarget();
  window.webkit = { messageHandlers: { seraflix: { postMessage: (message) => messages.push(message) } } };
  const classes = new Set();
  globalThis.document = { createElement: () => new Element(), documentElement: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } } };
  const dispatch = (name, data) => {
    const event = new Event('seraflix-native');
    event.detail = { event: name, data };
    window.dispatchEvent(event);
  };
  return { messages, classes, dispatch };
}

test('encaminha URL, busca, volume e faixas por mensagens estruturadas', () => {
  const { messages, dispatch, classes } = setup();
  const video = createMacVideo('Filme');
  const url = 'https://example.org/test.mkv?key=";alert(1)';
  video.src = url;
  assert.equal(messages.at(-1).command, 'load');
  assert.equal(messages.at(-1).args.url, url);
  assert.equal(classes.has('mac-playing'), true);
  video.currentTime = 90;
  assert.deepEqual(messages.at(-1).args, { position: 90 });
  video.volume = 0.7;
  assert.deepEqual(messages.at(-1).args, { value: 70 });
  video.muted = true;
  assert.deepEqual(messages.at(-1).args, { value: 0 });
  dispatch('tracks', { audio: [{ id: 12, lang: 'por', selected: false }], subtitles: [{ id: 4, title: 'ASS', selected: true }] });
  video.audioTracks[0].enabled = true;
  assert.deepEqual(messages.at(-1).args, { id: '12' });
  assert.equal(video.nativeSubtitles[0].id, '4');
  video.destroyNative();
});

test('converte eventos mpv para controles, retomada e fim existentes', () => {
  const { dispatch } = setup();
  const video = createMacVideo('Filme');
  const events = [];
  for (const name of ['loadedmetadata', 'playing', 'pause', 'waiting', 'ended']) video.addEventListener(name, () => events.push(name));
  video.src = 'https://example.org/test.mkv';
  dispatch('loaded', { duration: 120 });
  dispatch('time', { position: 5, duration: 120, paused: false, buffering: false, bufferEnd: 15 });
  assert.equal(video.duration, 120);
  assert.equal(video.currentTime, 5);
  assert.equal(video.buffered.end(0), 15);
  dispatch('time', { paused: true });
  dispatch('time', { buffering: true });
  dispatch('ended', {});
  assert.equal(video.ended, true);
  assert.deepEqual(events, ['loadedmetadata', 'playing', 'pause', 'waiting', 'ended']);
  video.destroyNative();
  dispatch('time', { position: 60 });
  assert.equal(video.currentTime, 5);
});

test('expõe erro nativo e encerra playback ao remover a fonte', () => {
  const { dispatch, messages, classes } = setup();
  const video = createMacVideo('Filme');
  video.src = 'https://example.org/test.mkv';
  dispatch('error', { message: 'Falha de rede' });
  assert.equal(video.error.message, 'Falha de rede');
  video.removeAttribute('src');
  video.load();
  assert.equal(messages.at(-1).command, 'stop');
  assert.equal(classes.has('mac-playing'), false);
  video.destroyNative();
});


test('mostra rejeição síncrona do load atual e ignora resposta de fonte anterior', () => {
  const { dispatch, messages } = setup();
  const video = createMacVideo('Filme');
  let errors = 0;
  video.addEventListener('error', () => errors++);
  video.src = 'https://example.org/old.mkv';
  const previous = messages.at(-1).id;
  video.src = 'https://example.org/current.mkv';
  const current = messages.at(-1).id;
  dispatch('response', { id: previous, ok: false, error: 'Fonte anterior' });
  assert.equal(errors, 0);
  dispatch('response', { id: current, ok: false, error: 'Renderização indisponível' });
  assert.equal(errors, 1);
  assert.equal(video.error.message, 'Renderização indisponível');
  dispatch('state', { volume: 25, mute: true });
  assert.equal(video.volume, 0.25);
  assert.equal(video.muted, true);
  video.destroyNative();
});
