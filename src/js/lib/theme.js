// Tema do app: 'light' (claro, padrão do Seraflix) | 'dark' (escuro do Kai) | 'oled' (preto puro).
export const THEMES = [
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Escuro' },
  { id: 'oled', label: 'OLED (preto puro)' },
];

// Perfis antigos só tinham o liga/desliga do OLED.
export function themeOf(s) {
  if (s.theme) return s.theme;
  return s.oled ? 'oled' : 'light';
}

export function applyTheme(s) {
  const theme = themeOf(s);
  document.body.classList.toggle('light', theme === 'light');
  document.body.classList.toggle('oled', theme === 'oled');
}
