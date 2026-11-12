/* dimensions.js — aspect ratio parsing, dimension calculation, I2I dimension updates */

import * as state from "./state-v2.js?v=x54";
import { mutableState } from "./state-v2.js?v=x54";
import { calcDimensionsApi } from "./api.js?v=x54";

export function parseAspectRatio(arStr) {
  arStr = (arStr || "").trim();
  if (arStr.includes(":")) {
    const parts = arStr.split(":");
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
  }
  const val = parseFloat(arStr);
  if (val > 0) return val;
  return 9 / 16;
}

export function calcDimensions(mp, ar) {
  const totalPixels = mp * 1_000_000;
  let w = Math.floor(Math.sqrt(totalPixels * ar));
  let h = Math.floor(Math.sqrt(totalPixels / ar));
  w = Math.max(64, Math.floor(w / 64) * 64);
  h = Math.max(64, Math.floor(h / 64) * 64);
  return [w, h];
}

// I2I does not sample at whatever pixels this app computes: the VAEs floor the latent to
// multiples of 8 (a 900×1500 Direct source came back 896×1496) and Qwen-Image 2.1's
// TextEncodeQwenImage21 returns the edit latent at the reference's own size rounded to 32
// (server side "resolution": 0). So the I2I canvas can only sit on a 32 px grid — snap it
// here, or the field, the job card and the file that lands all disagree.
// MP + AR sizes are already on a 64 grid, so this only bites a Direct source.
export function snapI2IDims(w, h) {
  return [Math.max(32, Math.round(w / 32) * 32), Math.max(32, Math.round(h / 32) * 32)];
}

export function formatAR(ar) {
  if (!ar || ar <= 0) return "?";
  const common = [
    [1, "1:1"],
    [21 / 9, "21:9"], [9 / 21, "9:21"],
    [2 / 1, "2:1"], [1 / 2, "1:2"],
    [16 / 9, "16:9"], [9 / 16, "9:16"],
    [16 / 10, "16:10"], [10 / 16, "10:16"],
    [3 / 2, "3:2"], [2 / 3, "2:3"],
    [4 / 3, "4:3"], [3 / 4, "3:4"],
    [5 / 4, "5:4"], [4 / 5, "4:5"],
    [1.85, "1.85:1"], [1 / 1.85, "1:1.85"],
    [2.39, "2.39:1"], [1 / 2.39, "1:2.39"],
  ];
  for (const [val, label] of common) {
    if (Math.abs(ar - val) < 0.02) return label;
  }
  return ar.toFixed(3);
}

export function recalcDimensions() {
  const mp = parseFloat(state.mpInput.value) || 1.0;
  const ar = state.arInput.value || "9:16";
  calcDimensionsApi(mp, ar)
    .then(data => {
      if (data.status === "ok") {
        state.width.value = data.width;
        state.height.value = data.height;
        state.calcDisplay.value = data.display;
      }
    });
}

export function updateI2IDimensions() {
  if (!mutableState.detectedImageAR || state.generationMode.value !== "I2I") return;
  const mp = parseFloat(state.mpInput.value) || 1.0;
  const srcSize = mutableState.sourceImageSize;
  const srcMP = srcSize ? (srcSize[0] * srcSize[1]) / 1e6 : 0;
  // Same rule main.js submits with: a source at its own megapixel count renders at its own
  // pixels (Direct), everything else at MP + detected AR. Showing only the MP+AR number made
  // this line disagree with the queue card on every Direct render (896×1472 here, 900×1500
  // or the snapped 896×1504 in the job).
  let w, h, exact = false;
  if (srcSize && srcMP > 0 && Math.abs(mp - srcMP) / srcMP < 0.02) {
    [w, h] = srcSize;
    exact = true;
  } else {
    [w, h] = calcDimensions(mp, mutableState.detectedImageAR);
  }
  const [rw, rh] = snapI2IDims(w, h);
  const snapped = rw !== w || rh !== h;
  w = rw; h = rh;
  state.width.value = w;
  state.height.value = h;
  const origMP = mutableState.originalImageMP || mp;
  const ratio = mp / origMP;
  const ratioStr = ratio >= 1 ? `${ratio.toFixed(2)}× upscale` : `${(1 / ratio).toFixed(2)}× downscale`;
  const label = exact
    ? (snapped ? `source ${srcSize[0]}×${srcSize[1]}, 32 px grid` : "no resize")
    : ratioStr + (snapped ? ", 32 px grid" : "");
  state.calcDisplay.value = `${mp} MP @ ${formatAR(mutableState.detectedImageAR)} → ${w}×${h} (${label})`;
}

export function updateDimensionVisibility() {
  const isMPAR = state.dimensionMode.value === "MP + AR";
  const isChain = state.generationMode.value === "T2I -> I2I" || state.generationMode.value === "T2I -> I2I (Reversed)" || state.generationMode.value === "T2I -> I2I (Ernie->Krea2)" || state.generationMode.value === "T2I -> I2I (Krea2->Ernie)" || state.generationMode.value === "T2I -> I2I (Ernie->Ernie)";
  const isT2I = state.generationMode.value === "T2I";
  const isI2I = state.generationMode.value === "I2I";

  if (isT2I) {
    state.mpArRow.style.display = isMPAR ? "flex" : "none";
    state.calcDisplayWrap.style.display = isMPAR ? "block" : "none";
    state.arInput.readOnly = false;
    const arLabel = state.arInput.parentElement.querySelector("label");
    if (arLabel) arLabel.textContent = "Aspect Ratio";
    if (isMPAR) recalcDimensions();
  } else if (isI2I) {
    state.mpArRow.style.display = mutableState.detectedImageAR ? "flex" : "none";
    state.calcDisplayWrap.style.display = mutableState.detectedImageAR ? "block" : "none";
    if (mutableState.detectedImageAR) {
      state.arInput.value = formatAR(mutableState.detectedImageAR);
      state.arInput.readOnly = true;
      const arLabel = state.arInput.parentElement.querySelector("label");
      if (arLabel) arLabel.textContent = "Detected Aspect Ratio";
      const mpLabel = state.mpInput.parentElement.querySelector("label");
      if (mpLabel) { mpLabel.textContent = "Target Megapixels"; mpLabel.title = "Resize input image to this megapixels before diffusion"; }
      updateI2IDimensions();
    }
  } else {
    state.mpArRow.style.display = "none";
    state.calcDisplayWrap.style.display = "none";
  }
}
