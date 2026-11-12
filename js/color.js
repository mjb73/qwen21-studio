/* color.js — theme color helpers (used by animation.js, ui.js) */

export function getThemeColor(varName, fallback) {
  const raw = getComputedStyle(document.body).getPropertyValue(varName).trim();
  return raw || fallback;
}

function hexToRgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) {
    hex = hex.split("").map(c => c + c).join("");
  }
  const num = parseInt(hex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbaFromVar(varName, alpha, fallbackHex) {
  const hex = getThemeColor(varName, fallbackHex);
  const rgb = hexToRgb(hex);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}
