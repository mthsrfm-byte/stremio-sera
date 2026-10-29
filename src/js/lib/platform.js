// Build para navegador (site/app, GitHub Pages) em vez do pacote da TV. Vem do build (tools/build.mjs).
export const IS_WEB = __KAI_WEB__;

// Build do Fire TV Stick (dist-firetv/): roda dentro do app Android (pasta android/), num WebView.
export const IS_FIRETV = __KAI_FIRETV__;

// Ponte do app Android (window.SeraflixAndroid): sair, IP, modelo e atualização. Null fora dele.
export function android() {
  return (IS_FIRETV && window.SeraflixAndroid) || null;
}

// O serviço do Seraflix na TV (TizenBrew): controle no celular, addons NSFW, atualização pelo
// TizenBrew. Só existe na Samsung; no navegador e no Fire TV não.
export const HAS_TV_SERVICE = !IS_WEB && !IS_FIRETV;

// Which TV we are running on. Samsung Tizen exposes window.tizen (packaged app / TizenBrew);
// its plain Internet browser does not, so the user agent is checked too.
export function isTizen() {
  return typeof window.tizen === 'object' || /Tizen/i.test(navigator.userAgent || '');
}

// Media and colour keys on Samsung must be registered before they reach the page.
export function registerTizenKeys() {
  const input = window.tizen && window.tizen.tvinputdevice;
  if (!input) return;
  ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'ChannelUp', 'ChannelDown', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach((k) => {
    try {
      input.registerKey(k);
    } catch (e) {
      /* key not on this remote */
    }
  });
}
