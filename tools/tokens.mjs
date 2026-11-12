// Tokens de design do app.css: no CSS, `$nome` vira o valor abaixo no build (tools/build.mjs).
// Os valores vão literais, com as mesmas maiúsculas do CSS antigo, para a saída sair igual.
export const tokens = {
  // Cores base
  paper: '#F5F4EF', // texto claro sobre escuro e fundo claro
  ink: '#111110', // texto escuro sobre claro e foco claro
  white: '#fff', // controles sobre o vídeo e texto sobre acento
  black: '#000',
  bg: '#0d0b14', // fundo do app
  panel: '#1C1C1A', // modais, toasts e painéis
  'surface-light': '#EDEBE4', // placeholder de pôster no tema claro
  accent: '#3347FF', // foco no app (azul)
  'accent-deep': '#2236E0', // texto azul no tema claro
  kai: '#7b5bf5', // roxo do tema Kai
  violet: '#9d85ff', // logo e destaques
  lilac: '#c9bbff', // bordas e textos lilás
  lavender: '#A9B4F5', // destaques sobre o escuro
  muted: '#A3A19A', // texto secundário
  nsfw: '#e5508c', // rosa da área NSFW
  'nsfw-soft': '#ffc2d9', // borda de foco NSFW
  error: '#ff8a8a',
  warn: '#F2A33A',
  ok: '#8FD9A8',
  // Variações com alfa (mesma cor, rgba)
  'paper-dim': 'rgba(245,244,239,0.6)',
  'paper-soft': 'rgba(245,244,239,0.85)',
  'paper-line': 'rgba(245,244,239,0.12)',
  'paper-faint': 'rgba(245,244,239,0.06)',
  'ink-dim': 'rgba(17,17,16,0.6)',
  'ink-faint': 'rgba(17,17,16,0.08)',
  'accent-glow': 'rgba(51,71,255,0.16)',
  'accent-tint': 'rgba(51,71,255,0.22)',
  'white-dim': 'rgba(255,255,255,0.6)',
  'white-soft': 'rgba(255,255,255,0.7)',
  'white-line': 'rgba(255,255,255,0.12)',
  surface: 'rgba(255,255,255,0.06)',
  'black-dim': 'rgba(0,0,0,0.6)',
  // Raios (border-radius)
  'r-xs': '6px',
  'r-sm': '12px',
  'r-card': '14px', // cartões e linhas
  'r-block': '18px', // sites e painéis
  'r-modal': '28px', // modais
  // Escala de fontes (font-size)
  'fs-label': '20px', // selos, rótulos, nome de cartão
  'fs-text': '22px', // metadados, texto e opções
  'fs-button': '24px', // botões e abas
  'fs-lead': '26px', // destaques
  'fs-row': '30px', // título de fileira
  'fs-section': '34px', // título de seção
  'fs-track': '40px', // título de trilha
  'fs-page': '48px', // título de página
  'fs-hero': '60px', // título de destaque
};
