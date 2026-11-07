// Ícones dos botões em SVG (traço em currentColor), no lugar dos símbolos de texto (▶ ⏭ ♫ ⇄...).
// Na TV esses símbolos caíam na fonte de emoji (o ⏭ virava um quadradinho azul) e cada um saía num
// tamanho. Todos aqui: grade de 24, traço 2, pontas arredondadas; os "cheios" levam a classe fill.
const PATHS = {
  play: { fill: true, d: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>' },
  pause: { fill: true, d: '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>' },
  restart: { d: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4.8h4.8"/>' },
  audio: { d: '<path d="M4 10v4"/><path d="M8 7v10"/><path d="M12 4v16"/><path d="M16 8v8"/><path d="M20 11v2"/>' },
  subs: { d: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 13h4"/><path d="M13 13h4"/><path d="M7 16.5h7"/>' },
  sources: { d: '<path d="M4 8h13"/><path d="m14 4.5 3.5 3.5-3.5 3.5"/><path d="M20 16H7"/><path d="m10 12.5-3.5 3.5 3.5 3.5"/>' },
  next: { fill: true, d: '<path d="M5 6.2v11.6a1 1 0 0 0 1.55.83l8.3-5.8a1 1 0 0 0 0-1.66l-8.3-5.8A1 1 0 0 0 5 6.2z"/><rect x="16.6" y="5" width="2.8" height="14" rx="1.2"/>' },
  skip: { fill: true, d: '<path d="M2.5 7.1v9.8a1 1 0 0 0 1.6.8l6.6-4.9a1 1 0 0 0 0-1.6L4.1 6.3a1 1 0 0 0-1.6.8z"/><path d="M12 7.1v9.8a1 1 0 0 0 1.6.8l6.6-4.9a1 1 0 0 0 0-1.6l-6.6-4.9a1 1 0 0 0-1.6.8z"/>' },
  heart: { d: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/>' },
  heartOn: { fill: true, d: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/>' },
  info: { d: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6v.1"/>' },
};

export function ico(name, extraCls) {
  const p = PATHS[name];
  if (!p) return '';
  return '<span class="ico' + (p.fill ? ' fill' : '') + (extraCls ? ' ' + extraCls : '') + '"><svg viewBox="0 0 24 24">' + p.d + '</svg></span>';
}
