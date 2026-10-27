// Estilo das legendas. Padrão igual ao mpv.conf do Kai:
// sub-font='Nata Sans', sub-bold=yes, sub-font-size=48 (≈64px em 1080p), sub-border-size=0.5, sub-shadow-offset=1.3.

export const FONTS = [
  { id: 'nata', label: 'Nata Sans (padrão Kai)', css: "'Nata Sans', 'Montserrat', sans-serif" },
  { id: 'montserrat', label: 'Montserrat', css: "'Montserrat', sans-serif" },
  { id: 'classic', label: 'Clássica (Arial)', css: 'Arial, Helvetica, sans-serif' },
];

export const STYLES = [
  { id: 'kai', label: 'Contorno fino + sombra (Kai)' },
  { id: 'outline', label: 'Contorno grosso' },
  { id: 'shadow', label: 'Só sombra' },
  { id: 'box', label: 'Caixa de fundo' },
];

export const COLORS = [
  { id: '#ffffff', label: 'Branco' },
  { id: '#ffe14d', label: 'Amarelo' },
  { id: '#dcdcdc', label: 'Cinza claro' },
  { id: '#8ff0ff', label: 'Ciano' },
];

export const POSITIONS = [
  { id: 'low', label: 'Baixa', bottom: 56 },
  { id: 'mid', label: 'Média', bottom: 120 },
  { id: 'high', label: 'Alta', bottom: 200 },
];

export const SIZES = [70, 85, 100, 115, 130, 150];

const BASE_PX = 64;

const SHADOWS = {
  kai: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 2px 2px 3px rgba(0,0,0,0.9)',
  outline:
    '-3px -3px 0 #000, 0 -3px 0 #000, 3px -3px 0 #000, 3px 0 0 #000, 3px 3px 0 #000, 0 3px 0 #000, -3px 3px 0 #000, -3px 0 0 #000, 0 0 8px rgba(0,0,0,0.8)',
  shadow: '3px 3px 6px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.6)',
  box: 'none',
};

function find(list, id) {
  return list.find((x) => x.id === id) || list[0];
}

// Aplica o estilo no contêiner .subs (e nos <span> pela classe).
export function apply(el, s) {
  const font = find(FONTS, s.subtitleFont);
  const pos = find(POSITIONS, s.subtitlePosition);
  el.style.fontFamily = font.css;
  el.style.fontSize = Math.round(BASE_PX * ((s.subtitleSize || 100) / 100)) + 'px';
  el.style.fontWeight = s.subtitleBold === false ? '500' : '700';
  el.style.color = s.subtitleColor || '#ffffff';
  el.style.textShadow = SHADOWS[s.subtitleStyle] || SHADOWS.kai;
  el.style.bottom = pos.bottom + 'px';
  el.classList.toggle('box', s.subtitleStyle === 'box');
}

export function labels(s) {
  return {
    font: find(FONTS, s.subtitleFont).label,
    style: find(STYLES, s.subtitleStyle).label,
    color: find(COLORS, s.subtitleColor).label,
    position: find(POSITIONS, s.subtitlePosition).label,
  };
}
