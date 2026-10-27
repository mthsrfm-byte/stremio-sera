// Estilo das legendas. Padrão igual ao mpv.conf do Kai:
// sub-font='Nata Sans', sub-bold=yes, sub-font-size=48 (≈64px em 1080p), sub-border-size=0.5, sub-shadow-offset=1.3.

// Cada fonte pode trazer sua própria diagramação (tamanho, peso, espaçamento, largura da linha).
// Bricolage Grotesque (a do Seraflix) é uma fonte de título: na legenda ela fica um pouco menor,
// em peso 600, com mais ar entre letras e palavras, entrelinha justa, linha de ~40 caracteres e um
// halo suave no lugar do contorno duro (que comeria os detalhes dela).
export const FONTS = [
  {
    id: 'bricolage',
    label: 'Bricolage Grotesque (padrão Seraflix)',
    css: "'Bricolage Grotesque', 'Geist', sans-serif",
    scale: 0.9,
    weights: { normal: 600, bold: 700 },
    letterSpacing: '0.012em',
    wordSpacing: '0.06em',
    lineHeight: 1.18,
    measure: 1320,
    halo: '0 0 2px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,0.9), 0 3px 14px rgba(0,0,0,0.6)',
  },
  { id: 'nata', label: 'Nata Sans (Kai)', css: "'Nata Sans', 'Montserrat', sans-serif" },
  { id: 'montserrat', label: 'Montserrat', css: "'Montserrat', sans-serif" },
  { id: 'classic', label: 'Clássica (Arial)', css: 'Arial, Helvetica, sans-serif' },
];

export const STYLES = [
  { id: 'kai', label: 'Padrão (contorno suave)' },
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
  const w = font.weights || { normal: 500, bold: 700 };
  el.style.fontFamily = font.css;
  el.style.fontSize = Math.round(BASE_PX * (font.scale || 1) * ((s.subtitleSize || 100) / 100)) + 'px';
  el.style.fontWeight = String(s.subtitleBold === false ? w.normal : w.bold);
  el.style.letterSpacing = font.letterSpacing || '';
  el.style.wordSpacing = font.wordSpacing || '';
  el.style.lineHeight = font.lineHeight ? String(font.lineHeight) : '';
  // Largura máxima da linha, centralizada (o contêiner ocupa a tela toda menos as margens).
  el.style.maxWidth = font.measure ? font.measure + 'px' : '';
  el.style.marginLeft = el.style.marginRight = font.measure ? 'auto' : '';
  el.style.color = s.subtitleColor || '#ffffff';
  // No estilo padrão, a fonte pode pedir um halo próprio em vez do contorno fino.
  const style = s.subtitleStyle || 'kai';
  el.style.textShadow = style === 'kai' && font.halo ? font.halo : SHADOWS[style] || SHADOWS.kai;
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
