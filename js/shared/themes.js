/* ================================================================
   SHARED: themes.js  —  Unified dark-mode theme system
   Used by: Prompt Assistant + ComfyUI Ernie Generator
   ================================================================ */

const THEMES = {
  cyberpunk: {
    fontDisplay: '"Chakra Petch", sans-serif',
    fontBody: '"Space Grotesk", sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    bg0: '#080c14',
    bg1: '#0f1a28',
    bgCard: 'rgba(13,22,36,0.92)',
    bgInput: '#0a111c',
    text: '#eaf2ff',
    muted: '#6b7f9f',
    accent: '#8df574',
    accentHover: '#76e9ff',
    pink: '#f36edc',
    border: '#234065',
    borderFocus: '#76e9ff',
    shadow: 'rgba(0,0,0,0.5)',
    glow1: 'rgba(141,245,116,0.06)',
    glow2: 'rgba(118,233,255,0.05)',
    cursorGlow: 'rgba(141,245,116,0.06)',
    modalBg: 'rgba(8,12,20,0.95)',
    rowAlt: 'rgba(0,0,0,0.15)',
  },
  ember: {
    fontDisplay: '"Syne", sans-serif',
    fontBody: '"DM Sans", sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    bg0: '#0c0c0c',
    bg1: '#181818',
    bgCard: 'rgba(24,24,24,0.94)',
    bgInput: '#121212',
    text: '#f0ece6',
    muted: '#8a7f72',
    accent: '#e8a838',
    accentHover: '#ff9e5e',
    pink: '#e86a6a',
    border: '#2d2d2d',
    borderFocus: '#ff9e5e',
    shadow: 'rgba(0,0,0,0.5)',
    glow1: 'rgba(232,168,56,0.06)',
    glow2: 'rgba(255,158,94,0.05)',
    cursorGlow: 'rgba(232,168,56,0.06)',
    modalBg: 'rgba(12,12,12,0.95)',
    rowAlt: 'rgba(0,0,0,0.15)',
  },
  aurora: {
    fontDisplay: '"Quicksand", sans-serif',
    fontBody: '"Nunito", sans-serif',
    fontMono: '"Space Mono", monospace',
    bg0: '#0d081a',
    bg1: '#1a122e',
    bgCard: 'rgba(26,18,46,0.94)',
    bgInput: '#140d24',
    text: '#f0e8ff',
    muted: '#8a7fa0',
    accent: '#c084fc',
    accentHover: '#5ce1c3',
    pink: '#f472b6',
    border: '#2d1e4d',
    borderFocus: '#c084fc',
    shadow: 'rgba(0,0,0,0.5)',
    glow1: 'rgba(192,132,252,0.06)',
    glow2: 'rgba(92,225,195,0.05)',
    cursorGlow: 'rgba(192,132,252,0.06)',
    modalBg: 'rgba(13,8,26,0.95)',
    rowAlt: 'rgba(0,0,0,0.15)',
  },
  inferno: {
    fontDisplay: '"Kanit", sans-serif',
    fontBody: '"Barlow", sans-serif',
    fontMono: '"JetBrains Mono", monospace',
    bg0: '#0a0505',
    bg1: '#1a0f0f',
    bgCard: 'rgba(26,15,15,0.94)',
    bgInput: '#120a0a',
    text: '#f5e8e0',
    muted: '#7a6b6b',
    accent: '#ff6b35',
    accentHover: '#ffaa33',
    pink: '#e63946',
    border: '#3d1f1f',
    borderFocus: '#ff6b35',
    shadow: 'rgba(0,0,0,0.5)',
    glow1: 'rgba(255,107,53,0.06)',
    glow2: 'rgba(255,170,51,0.05)',
    cursorGlow: 'rgba(255,107,53,0.06)',
    modalBg: 'rgba(10,5,5,0.95)',
    rowAlt: 'rgba(0,0,0,0.15)',
  },
  // PhotoCraft AI — the graphite desktop palette of the PhotoCraft editor itself: flat greys, thin
  // separators, a single blue accent, small radii, no glow. Used when this engine is embedded in
  // the PhotoCraft AI panel (?theme=photocraft) so the two halves read as one application.
  photocraft: {
    fontDisplay: '"Inter", "Noto Sans", "DejaVu Sans", system-ui, sans-serif',
    fontBody: '"Inter", "Noto Sans", "DejaVu Sans", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", ui-monospace, "DejaVu Sans Mono", monospace',
    bg0: '#232323',
    bg1: '#2f2f2f',
    bgCard: '#3a3a3a',
    bgInput: '#2a2a2a',
    text: '#e6e6e6',
    muted: '#a3a3a3',
    accent: '#4c8dd8',
    accentHover: '#6aa6e8',
    pink: '#c86f6f',
    border: '#1d1d1d',
    borderFocus: '#4c8dd8',
    shadow: 'rgba(0,0,0,0.45)',
    glow1: 'rgba(0,0,0,0)',
    glow2: 'rgba(0,0,0,0)',
    cursorGlow: 'rgba(0,0,0,0)',
    modalBg: 'rgba(35,35,35,0.98)',
    rowAlt: 'rgba(255,255,255,0.03)',
    radius: '3px',
    radiusSm: '2px',
  },
};

const DEFAULT_THEME = 'cyberpunk';
const STORAGE_KEY_PA = 'pa_theme';
const STORAGE_KEY_CEG = 'ceg_theme';

function _getTheme(name) {
  return THEMES[name] || THEMES[DEFAULT_THEME];
}

export function getThemeNames() {
  return Object.keys(THEMES);
}

export function applyTheme(name) {
  const t = _getTheme(name);
  const root = document.documentElement;
  root.dataset.theme = name;
  root.style.setProperty('--font-display', t.fontDisplay);
  root.style.setProperty('--font-body', t.fontBody);
  root.style.setProperty('--font-mono', t.fontMono);
  root.style.setProperty('--bg-0', t.bg0);
  root.style.setProperty('--bg-1', t.bg1);
  root.style.setProperty('--bg-card', t.bgCard);
  root.style.setProperty('--bg-input', t.bgInput);
  root.style.setProperty('--text', t.text);
  root.style.setProperty('--muted', t.muted);
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-hover', t.accentHover);
  root.style.setProperty('--pink', t.pink);
  root.style.setProperty('--border', t.border);
  root.style.setProperty('--border-focus', t.borderFocus);
  root.style.setProperty('--shadow', t.shadow);
  root.style.setProperty('--glow-1', t.glow1);
  root.style.setProperty('--glow-2', t.glow2);
  root.style.setProperty('--cursor-glow', t.cursorGlow);
  root.style.setProperty('--modal-bg', t.modalBg);
  root.style.setProperty('--row-alt', t.rowAlt);
  // PhotoCraft's desktop controls are nearly square; the other themes keep the app's own 12 px.
  if (t.radius) root.style.setProperty('--radius', t.radius);
  if (t.radiusSm) root.style.setProperty('--radius-sm', t.radiusSm);
  if (typeof dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: name, palette: t } }));
  }
}

export function initTheme(selectEl, storageKey = STORAGE_KEY_PA) {
  // ?theme= wins over the stored choice and is not persisted: an embedded instance (the PhotoCraft
  // AI panel) must keep matching the host's palette without rewriting the user's preference.
  const forced = new URLSearchParams(location.search).get('theme');
  const saved = forced || localStorage.getItem(storageKey) || DEFAULT_THEME;
  applyTheme(saved);
  if (selectEl) {
    selectEl.value = saved;
    selectEl.addEventListener('change', () => {
      const theme = selectEl.value;
      applyTheme(theme);
      localStorage.setItem(storageKey, theme);
    });
  }
  return saved;
}

export function getCurrentTheme() {
  return document.documentElement.dataset.theme || DEFAULT_THEME;
}

export function getThemeColor(varName, fallback) {
  const raw = getComputedStyle(document.body).getPropertyValue(varName).trim();
  return raw || fallback;
}

export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
}

export function rgbaFromVar(varName, alpha, fallbackHex) {
  const hex = getThemeColor(varName, fallbackHex);
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
