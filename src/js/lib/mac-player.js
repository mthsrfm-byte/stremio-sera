// Adaptador leve: o player mantém seus controles e histórico; só a mídia vai para o libmpv.
// Sem efeitos ao importar, para que o build da TV/web elimine este módulo por completo.
export function nativeCommand(command, args = {}) {
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.seraflix;
  if (!handler) return false;
  handler.postMessage({ version: 1, id: String(Date.now()) + '-' + Math.random().toString(36).slice(2), command, args });
  return true;
}

export function createMacVideo(title) {
  const el = document.createElement('div');
  el.className = 'mac-video';
  const state = { src: '', currentTime: 0, duration: NaN, paused: true, buffering: true, ended: false, volume: 1, muted: false, readyState: 0, error: null };
  let audio = [];
  let subtitles = [];
  let bufferEnd = 0;
  let active = true;
  const emit = (name) => el.dispatchEvent(new Event(name));
  const number = (value, fallback) => typeof value === 'number' && isFinite(value) ? value : fallback;
  function onNative(event) {
    const packet = event.detail || {};
    const data = packet.data || {};
    if (!active || !state.src) return;
    if (packet.event === 'time') {
      const wasPaused = state.paused;
      const wasBuffering = state.buffering;
      state.currentTime = Math.max(0, number(data.position, state.currentTime));
      state.duration = number(data.duration, state.duration);
      state.paused = typeof data.paused === 'boolean' ? data.paused : state.paused;
      state.buffering = typeof data.buffering === 'boolean' ? data.buffering : state.buffering;
      bufferEnd = number(data.bufferEnd, state.currentTime);
      if (wasPaused !== state.paused && state.paused) emit('pause');
      if (!state.paused && !state.buffering && (wasPaused || wasBuffering)) emit('playing');
      if (wasBuffering !== state.buffering) emit(state.buffering ? 'waiting' : 'canplay');
      emit('timeupdate');
    } else if (packet.event === 'loaded') {
      state.duration = number(data.duration, state.duration);
      state.readyState = 4;
      state.ended = false;
      emit('loadedmetadata');
      emit('canplay');
      // time pode chegar antes de loaded: não depender de outra transição para esconder a abertura.
      if (!state.paused && !state.buffering) emit('playing');
    } else if (packet.event === 'tracks') {
      audio = (data.audio || []).map((track) => {
        const item = { id: String(track.id), language: track.lang || '', label: track.title || '', selected: !!track.selected };
        Object.defineProperty(item, 'enabled', {
          get: () => item.selected,
          set: (selected) => { item.selected = selected; if (selected) nativeCommand('audio', { id: item.id }); },
        });
        return item;
      });
      subtitles = (data.subtitles || []).map((track) => ({ id: String(track.id), lang: track.lang || '', label: track.title || '', codec: track.codec || '', selected: !!track.selected }));
      emit('nativetracks');
    } else if (packet.event === 'ended') {
      state.ended = true;
      state.paused = true;
      emit('ended');
    } else if (packet.event === 'error') {
      state.error = { code: 3, message: data.message || 'Erro no player nativo' };
      emit('error');
    }
  }
  window.addEventListener('seraflix-native', onNative);
  Object.keys(state).forEach((key) => Object.defineProperty(el, key, {
    get: () => state[key],
    set: (value) => {
      state[key] = value;
      if (key === 'src') {
        el.setAttribute('src', value);
        state.readyState = 0;
        state.ended = false;
        state.error = null;
        state.paused = true;
        state.buffering = true;
        document.documentElement.classList.add('mac-playing');
        if (!nativeCommand('load', { url: value, title: title || 'Seraflix', startTime: 0 })) {
          state.error = { code: 4, message: 'A ponte do Mac não está disponível.' };
          setTimeout(() => emit('error'), 0);
        }
      } else if (key === 'currentTime') {
        nativeCommand('seek', { position: Math.max(0, number(value, 0)) });
        emit('seeked');
      } else if (key === 'volume' || key === 'muted') nativeCommand('volume', { value: state.muted ? 0 : Math.max(0, Math.min(1, state.volume)) * 100 });
    },
  }));
  Object.defineProperties(el, {
    audioTracks: { get: () => audio },
    nativeSubtitles: { get: () => subtitles },
    buffered: { get: () => ({ length: bufferEnd > 0 ? 1 : 0, start: () => 0, end: () => bufferEnd }) },
    seeking: { get: () => false },
    networkState: { get: () => state.src ? 2 : 0 },
  });
  el.play = () => { nativeCommand('play'); return Promise.resolve(); };
  el.pause = () => nativeCommand('pause');
  el.load = () => {
    if (!el.getAttribute('src')) {
      state.src = '';
      nativeCommand('stop');
      document.documentElement.classList.remove('mac-playing');
    }
  };
  el.destroyNative = () => {
    active = false;
    window.removeEventListener('seraflix-native', onNative);
    nativeCommand('stop');
    document.documentElement.classList.remove('mac-playing');
  };
  el.addEventListener('dblclick', () => nativeCommand('fullscreen'));
  return el;
}

// O cache abre sem esperar servidor/Internet. O catálogo atualiza quando os addons responderem.
export function startMacInBackground(server, addons, router) {
  server.check();
  addons.load().catch(() => null).then(() => {
    const home = router.tabView('home');
    if (home && home.reload) home.reload();
  });
}

export function installMacHooks(server, toast, openPlayer) {
  window.addEventListener('seraflix-native', (event) => {
    const packet = event.detail || {};
    if (packet.event !== 'server') return;
    const data = packet.data || {};
    if (data.state === 'ready' || data.state === 'running') server.check();
    else if (data.message) toast(data.message, data.state === 'error' ? 8000 : 4000);
  });
  window.addEventListener('seraflix-open-url', (event) => {
    const url = typeof event.detail === 'string' ? event.detail : '';
    if (!/^(https?:|magnet:)/i.test(url)) return toast('Use um link HTTP, HTTPS ou magnet.');
    openPlayer({ meta: { id: 'dev', type: 'movie', name: 'Abrir URL' }, video: { id: 'dev' }, stream: { url }, streams: [{ url }] });
  });
  nativeCommand('serverStatus');
}
