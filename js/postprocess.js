/* postprocess.js — pixel-accurate live post-process preview */

import * as state from "./state-v2.js?v=x54";
import { showToast, bindRange } from "./ui.js?v=x54";
import { processImage } from "./api.js?v=x54";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/* ═══════════════════════════════════════════════════════════════
   Original pixel snapshot  (captured when a new image arrives)
   ═══════════════════════════════════════════════════════════════ */
let _originalSrc = "";
let _pixelW = 0;
let _pixelH = 0;
let _pixelBuf = null; // Uint8ClampedArray  – RGBA

/* ── Show / hide panel ------------------------------------------------ */
export function showPostProcess() {
  if (state.postProcessPanel) {
    state.postProcessPanel.style.display = "block";
    state.postProcessPanel.classList.add("active");
  }
}

export function hidePostProcess() {
  if (state.postProcessPanel) {
    state.postProcessPanel.style.display = "none";
    state.postProcessPanel.classList.remove("active");
  }
}

/* ── Toggle ----------------------------------------------------------- */
export function isPostProcessEnabled() {
  return state.ppEnabled?.checked === true;
}

export function updateToggleUI() {
  const enabled = isPostProcessEnabled();
  if (state.ppControlsRow) {
    state.ppControlsRow.classList.toggle("disabled", !enabled);
  }
  if (state.ppEnabled) {
    const label = state.ppEnabled.closest(".pp-toggle")?.querySelector(".pp-toggle-label");
    if (label) label.textContent = enabled ? "On" : "Off";
  }
}

export function bindPostProcessToggle() {
  if (!state.ppEnabled) return;
  state.ppEnabled.addEventListener("change", () => {
    updateToggleUI();
    savePostProcessState();
    if (isPostProcessEnabled()) {
      updateLivePreview();
    } else {
      restoreOriginalImage();
    }
  });
  updateToggleUI();
}

/* ── Range bindings --------------------------------------------------- */
export function bindPostProcessRanges() {
  const bindings = [
    [state.ppShadows, state.ppShadowsVal],
    [state.ppHighlights, state.ppHighlightsVal],
    [state.ppOutMin, state.ppOutMinVal],
    [state.ppOutMax, state.ppOutMaxVal],
    [state.ppContrast, state.ppContrastVal],
    [state.ppSaturation, state.ppSaturationVal],
    [state.ppTemperature, state.ppTemperatureVal],
    [state.ppBrilliance, state.ppBrillianceVal],
    [state.ppVigExposure, state.ppVigExposureVal],
    [state.ppVigHardness, state.ppVigHardnessVal],
    [state.ppVigScale, state.ppVigScaleVal],
    [state.ppVigShape, state.ppVigShapeVal],
  ];
  const defaults = new Map([
    [state.ppShadows, 0],
    [state.ppHighlights, 255],
    [state.ppOutMin, 0],
    [state.ppOutMax, 255],
    [state.ppContrast, 1.0],
    [state.ppSaturation, 1.0],
    [state.ppTemperature, 50],
    [state.ppBrilliance, 100],
    [state.ppVigExposure, 0],
    [state.ppVigHardness, 0.5],
    [state.ppVigScale, 1.0],
    [state.ppVigShape, 100],
  ]);
  bindings.forEach(([input, display]) => {
    if (input && display) {
      bindRange(input, display);
      input.addEventListener("change", updateLivePreview);
      input.addEventListener("change", savePostProcessState);
      input.addEventListener("dblclick", () => {
        const def = defaults.get(input);
        if (def !== undefined) {
          input.value = def;
          display.textContent = def;
          updateLivePreview();
          savePostProcessState();
        }
      });
    }
  });
  if (state.ppSaveMode) {
    state.ppSaveMode.addEventListener("change", savePostProcessState);
  }
  restorePostProcessState();
}

/* ── Reset------------------------------------------------------------ */
export function resetPostProcess() {
  if (state.ppShadows) { state.ppShadows.value = 0; state.ppShadowsVal.textContent = "0"; }
  if (state.ppHighlights) { state.ppHighlights.value = 255; state.ppHighlightsVal.textContent = "255"; }
  if (state.ppOutMin) { state.ppOutMin.value = 0; state.ppOutMinVal.textContent = "0"; }
  if (state.ppOutMax) { state.ppOutMax.value = 255; state.ppOutMaxVal.textContent = "255"; }
  if (state.ppContrast) { state.ppContrast.value = 1.0; state.ppContrastVal.textContent = "1.0"; }
  if (state.ppSaturation) { state.ppSaturation.value = 1.0; state.ppSaturationVal.textContent = "1.0"; }
  if (state.ppTemperature) { state.ppTemperature.value = 50; state.ppTemperatureVal.textContent = "50"; }
  if (state.ppBrilliance) { state.ppBrilliance.value = 100; state.ppBrillianceVal.textContent = "100"; }
  if (state.ppVigExposure) { state.ppVigExposure.value = 0; state.ppVigExposureVal.textContent = "0"; }
  if (state.ppVigHardness) { state.ppVigHardness.value = 0.5; state.ppVigHardnessVal.textContent = "0.5"; }
  if (state.ppVigScale) { state.ppVigScale.value = 1.0; state.ppVigScaleVal.textContent = "1.0"; }
  if (state.ppVigShape) { state.ppVigShape.value = 100; state.ppVigShapeVal.textContent = "100"; }
  if (state.ppSaveMode) state.ppSaveMode.value = "copy";
  restoreOriginalImage();
}

function restoreOriginalImage() {
  const img = state.outputImage;
  if (!img) return;
  if (_originalSrc) {
    img.src = _originalSrc;
  }
  img.style.filter = "none";
  const canvas = state.outputVignetteCanvas;
  if (canvas) {
    canvas.style.display = "none";
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/* ── Persistence ------------------------------------------------------- */
const PP_STORAGE_KEY = "ceg_postprocess_state";

export function savePostProcessState() {
  const data = {};
  const inputs = [
    ["enabled", state.ppEnabled],
    ["shadows", state.ppShadows],
    ["highlights", state.ppHighlights],
    ["outMin", state.ppOutMin],
    ["outMax", state.ppOutMax],
    ["contrast", state.ppContrast],
    ["saturation", state.ppSaturation],
    ["temperature", state.ppTemperature],
    ["brilliance", state.ppBrilliance],
    ["vigExposure", state.ppVigExposure],
    ["vigHardness", state.ppVigHardness],
    ["vigScale", state.ppVigScale],
    ["vigShape", state.ppVigShape],
    ["saveMode", state.ppSaveMode],
  ];
  inputs.forEach(([key, el]) => {
    if (el) data[key] = el.type === "checkbox" ? el.checked : el.value;
  });
  try {
    localStorage.setItem(PP_STORAGE_KEY, JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

export function restorePostProcessState() {
  let data = {};
  try {
    const raw = localStorage.getItem(PP_STORAGE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { return; }

  const mapping = {
    shadows: [state.ppShadows, state.ppShadowsVal],
    highlights: [state.ppHighlights, state.ppHighlightsVal],
    outMin: [state.ppOutMin, state.ppOutMinVal],
    outMax: [state.ppOutMax, state.ppOutMaxVal],
    contrast: [state.ppContrast, state.ppContrastVal],
    saturation: [state.ppSaturation, state.ppSaturationVal],
    temperature: [state.ppTemperature, state.ppTemperatureVal],
    brilliance: [state.ppBrilliance, state.ppBrillianceVal],
    vigExposure: [state.ppVigExposure, state.ppVigExposureVal],
    vigHardness: [state.ppVigHardness, state.ppVigHardnessVal],
    vigScale: [state.ppVigScale, state.ppVigScaleVal],
    vigShape: [state.ppVigShape, state.ppVigShapeVal],
  };
  Object.entries(mapping).forEach(([key, [input, display]]) => {
    if (input && data[key] !== undefined) {
      input.value = data[key];
      if (display) display.textContent = input.value; // reflect browser clamping
    }
  });
  if (state.ppSaveMode && data.saveMode !== undefined) {
    state.ppSaveMode.value = data.saveMode;
  }
  if (state.ppEnabled && data.enabled !== undefined) {
    state.ppEnabled.checked = data.enabled === true || data.enabled === "true";
  }
  updateToggleUI();
}

/* ── Params from UI --------------------------------------------------- */
export function getPostProcessParams() {
  return {
    shadows: parseInt(state.ppShadows?.value ?? 0, 10),
    highlights: parseInt(state.ppHighlights?.value ?? 255, 10),
    output_min: parseInt(state.ppOutMin?.value ?? 0, 10),
    output_max: parseInt(state.ppOutMax?.value ?? 255, 10),
    contrast: parseFloat(state.ppContrast?.value ?? 1.0),
    saturation: parseFloat(state.ppSaturation?.value ?? 1.0),
    temperature: parseInt(state.ppTemperature?.value ?? 50, 10) - 50,
    brilliance: parseFloat(state.ppBrilliance?.value ?? 100) / 100,
    vignette_exposure: parseFloat(state.ppVigExposure?.value ?? 0),
    vignette_hardness: parseFloat(state.ppVigHardness?.value ?? 0.5),
    vignette_scale: parseFloat(state.ppVigScale?.value ?? 1.0),
    vignette_shape: parseFloat(state.ppVigShape?.value ?? 100) / 100,
    save_mode: state.ppSaveMode?.value ?? "copy",
  };
}

/* ════════════════════════════════════════════════════════════════════
   Pixel-accurate live preview
   ════════════════════════════════════════════════════════════════════ */
export function updateLivePreview() {
  const img = state.outputImage;
  if (!img || img.style.display === "none" || !_pixelBuf) return;

  if (!isPostProcessEnabled()) {
    restoreOriginalImage();
    return;
  }

  const p = getPostProcessParams();

  // Clone original pixels
  const src = new Uint8ClampedArray(_pixelBuf);
  const w = _pixelW;
  const h = _pixelH;
  const len = src.length;

  /* ---- Levels ------------------------------------------------------ */
  const inMin = clamp(p.shadows, 0, 255);
  const inMax = clamp(p.highlights, Math.max(inMin + 1, 1), 255);
  const outMin = clamp(p.output_min, 0, 255);
  const outMax = clamp(p.output_max, outMin + 1, 255);
  const lvlScale = (outMax - outMin) / (inMax - inMin);

  /* ---- Contrast multiplier ---------------------------------------- */
  const ctr = p.contrast;

  /* ---- Saturation pre-calc ---------------------------------------- */
  const sat = p.saturation;
  const satGrayR = 0.299;
  const satGrayG = 0.587;
  const satGrayB = 0.114;

  /* ---- White balance + brilliance offsets ------------------------- */
  const tempOff = p.temperature;   // -50 … +50  (0 = neutral)
  const briMul = p.brilliance;   // 0.0 … 2.0   (1.0 = neutral)

  /* ---- Vignette pre-calc ------------------------------------------ */
  const vigExp = p.vignette_exposure;
  const vigHard = p.vignette_hardness;
  const vigScale = Math.max(p.vignette_scale, 0.01);
  // shapeRaw: 0.0 = vertical line, 1.0 = circle, 2.0 = horizontal line
  const shapeRaw = p.vignette_shape;

  const cx = w / 2.0;
  const cy = h / 2.0;
  const vigStrength = vigExp < 0 ? Math.abs(vigExp) : 0;
  const power = vigHard > 0.99 ? null : (vigHard > 0.01 ? 1.0 / Math.max(1.0 - vigHard, 0.01) : 1.0);

  // Process every pixel
  for (let y = 0; y < h; y++) {
    const dy = (Math.abs(y - cy) / cy);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;

      // --- Levels ---
      let r = (src[i] - inMin) * lvlScale + outMin;
      let g = (src[i + 1] - inMin) * lvlScale + outMin;
      let b = (src[i + 2] - inMin) * lvlScale + outMin;

      // --- Contrast ---
      if (ctr !== 1.0) {
        r = (r - 128) * ctr + 128;
        g = (g - 128) * ctr + 128;
        b = (b - 128) * ctr + 128;
      }

      // --- Saturation (luminance-based) ---
      if (sat !== 1.0) {
        const lum = r * satGrayR + g * satGrayG + b * satGrayB;
        r = lum + (r - lum) * sat;
        g = lum + (g - lum) * sat;
        b = lum + (b - lum) * sat;
      }

      // --- White balance (temperature + brilliance) ---
      if (tempOff !== 0) {
        r += tempOff;
        b -= tempOff;
      }
      if (briMul !== 1.0) {
        r *= briMul;
        g *= briMul;
        b *= briMul;
      }

      // --- Clamp before vignette ---
      r = clamp(r, 0, 255);
      g = clamp(g, 0, 255);
      b = clamp(b, 0, 255);

      // --- Vignette ---
      if (vigStrength > 0) {
        const dx = (Math.abs(x - cx) / cx);
        let dist;
        if (shapeRaw <= 1.0) {
          // 0.0 = vertical line, 1.0 = circle
          dist = Math.sqrt(dx * dx + (shapeRaw * dy) ** 2) / vigScale;
        } else {
          // 1.0 = circle, 2.0 = horizontal line
          const mult = 2.0 - shapeRaw;
          dist = Math.sqrt((mult * dx) ** 2 + dy * dy) / vigScale;
        }
        dist = clamp(dist, 0.0, 1.0);
        if (power === null) {
          dist = dist >= 1.0 ? 1.0 : 0.0;
        } else if (power !== 1.0) {
          dist = Math.pow(dist, power);
        }
        const factor = 1.0 - dist * Math.min(vigStrength, 1.0);
        r *= factor;
        g *= factor;
        b *= factor;
      }

      src[i] = clamp(r, 0, 255);
      src[i + 1] = clamp(g, 0, 255);
      src[i + 2] = clamp(b, 0, 255);
    }
  }

  // Write processed pixels to a temp canvas → data URL → img.src
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const idata = new ImageData(src, w, h);
  ctx.putImageData(idata, 0, 0);

  img.style.filter = "none";
  const can = state.outputVignetteCanvas;
  if (can) can.style.display = "none";

  // JPEG for speed (smaller data URL), quality 0.92
  img.src = canvas.toDataURL("image/jpeg", 0.92);
}

/* ── Apply & Save ----------------------------------------------------- */
export async function applyPostProcess() {
  const img = state.outputImage;
  if (!img || !img.src || img.style.display === "none") {
    showToast("No image to process", "error");
    return;
  }

  let filename = "";
  try {
    const url = new URL(_originalSrc, window.location.href);
    filename = url.searchParams.get("filename") || "";
  } catch {
    const m = _originalSrc.match(/filename=([^&]+)/);
    if (m) filename = decodeURIComponent(m[1]);
  }
  if (!filename) {
    showToast("Could not determine image filename", "error");
    return;
  }

  const params = getPostProcessParams();
  params.filename = filename;

  showToast("Processing image...", "success");
  try {
    const data = await processImage(params);
    if (data.status === "ok") {
      // After saving, revert display to the ORIGINAL image so the user
      // can keep creating more variants from the same source.
      restoreOriginalImage();
      showToast(`Saved as ${data.filename}`, "success");
    } else {
      showToast(data.message || "Processing failed", "error");
    }
  } catch (err) {
    showToast("Server error: " + (err.message || "Unknown"), "error");
  }
}

/* ════════════════════════════════════════════════════════════════════
   Image arrival → snapshot original pixels for live preview
   ════════════════════════════════════════════════════════════════════ */
export function onImageSet() {
  const img = state.outputImage;
  if (!img || !img.src) return;
  _originalSrc = img.src;
  captureOriginalPixels(img.src);
  // Always default toggle OFF when a new image arrives
  if (state.ppEnabled) state.ppEnabled.checked = false;
  updateToggleUI();
}

async function captureOriginalPixels(url) {
  return new Promise((resolve) => {
    const temp = new Image();
    temp.crossOrigin = "anonymous";
    temp.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = temp.naturalWidth;
      canvas.height = temp.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(temp, 0, 0);
      _pixelW = canvas.width;
      _pixelH = canvas.height;
      _pixelBuf = ctx.getImageData(0, 0, _pixelW, _pixelH).data;
      resolve();
    };
    temp.onerror = () => resolve();
    temp.src = url;
  });
}
