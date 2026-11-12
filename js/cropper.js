/* cropper.js — cropper modal functionality (canvas drawing, selection, preview, copy) */

import * as state from "./state-v2.js?v=x54";
import { mutableState } from "./state-v2.js?v=x54";
import { showToast } from "./ui.js?v=x54";
import { parseAspectRatio, formatAR } from "./dimensions.js?v=x54";

export function openCropper() {
  if (!state.outputImage.src) {
    showToast("No output image to view", "error");
    return;
  }
  state.cropperModal.classList.remove("hidden");
  state.cropperImage.src = state.outputImage.src;
  state.cropperImage.onload = () => {
    state.cropperCanvas.width = state.cropperImage.naturalWidth;
    state.cropperCanvas.height = state.cropperImage.naturalHeight;
    mutableState.cropCtx = state.cropperCanvas.getContext("2d");
    resetCropper();
  };
  state.cropperImage.onerror = () => {
    showToast("Failed to load image", "error");
    closeCropper();
  };
}

export function closeCropper() {
  state.cropperModal.classList.add("hidden");
  state.cropperPreviewPanel.classList.add("hidden");
  resetCropper();
}

export function resetCropper() {
  mutableState.isDrawing = false;
  mutableState.isDragging = false;
  mutableState.cropStart = { x: 0, y: 0 };
  mutableState.cropEnd = { x: 0, y: 0 };
  state.cropperStats.classList.add("hidden");
  if (mutableState.cropCtx) {
    mutableState.cropCtx.clearRect(0, 0, state.cropperCanvas.width, state.cropperCanvas.height);
  }
}

export function getMousePos(e) {
  const rect = state.cropperCanvas.getBoundingClientRect();
  const scaleX = state.cropperCanvas.width / rect.width;
  const scaleY = state.cropperCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

export function constrainRect(x1, y1, x2, y2) {
  let w = Math.abs(x2 - x1);
  let h = Math.abs(y2 - y1);
  let nx1 = Math.min(x1, x2);
  let ny1 = Math.min(y1, y2);

  const arStr = state.cropperAR.value;
  if (arStr) {
    const ar = parseAspectRatio(arStr);
    if (w / h > ar) {
      w = h * ar;
    } else {
      h = w / ar;
    }
    if (x2 >= x1) {
      nx1 = x1;
    } else {
      nx1 = x1 - w;
    }
    if (y2 >= y1) {
      ny1 = y1;
    } else {
      ny1 = y1 - h;
    }
  }
  return { x: nx1, y: ny1, w, h };
}

export function drawCropOverlay() {
  if (!mutableState.cropCtx) return;
  const cw = state.cropperCanvas.width;
  const ch = state.cropperCanvas.height;
  mutableState.cropCtx.clearRect(0, 0, cw, ch);

  if (!mutableState.isDrawing && mutableState.cropStart.x === mutableState.cropEnd.x && mutableState.cropStart.y === mutableState.cropEnd.y) return;

  const r = constrainRect(mutableState.cropStart.x, mutableState.cropStart.y, mutableState.cropEnd.x, mutableState.cropEnd.y);
  if (r.w <= 0 || r.h <= 0) return;

  mutableState.cropCtx.fillStyle = "rgba(8, 12, 20, 0.55)";
  mutableState.cropCtx.fillRect(0, 0, cw, ch);
  mutableState.cropCtx.clearRect(r.x, r.y, r.w, r.h);

  mutableState.cropCtx.strokeStyle = "#8df574";
  mutableState.cropCtx.lineWidth = 2;
  mutableState.cropCtx.strokeRect(r.x, r.y, r.w, r.h);

  const mp = (r.w * r.h) / 1_000_000;
  const ar = r.h === 0 ? 0 : r.w / r.h;
  state.cropperStats.innerHTML =
    `<div>W: ${Math.round(r.w)} &nbsp; H: ${Math.round(r.h)}</div>
     <div>MP: ${mp.toFixed(3)} &nbsp; AR: ${formatAR(ar)}</div>`;
  state.cropperStats.classList.remove("hidden");
}

export function endCrop() {
  mutableState.isDrawing = false;
  mutableState.isDragging = false;
  const r = constrainRect(mutableState.cropStart.x, mutableState.cropStart.y, mutableState.cropEnd.x, mutableState.cropEnd.y);
  if (r.w > 0 && r.h > 0) {
    showCropPreview(r.x, r.y, r.w, r.h);
  }
}

export function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

export function showCropPreview(x, y, w, h) {
  const ctx = state.cropperPreviewCanvas.getContext("2d");
  state.cropperPreviewCanvas.width = w;
  state.cropperPreviewCanvas.height = h;
  ctx.drawImage(state.cropperImage, x, y, w, h, 0, 0, w, h);
  state.cropperPreviewPanel.classList.remove("hidden");
}

export async function copyCropToClipboard() {
  try {
    const blob = await new Promise((resolve) =>
      state.cropperPreviewCanvas.toBlob(resolve, "image/png")
    );
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    state.btnCopyCrop.classList.add("btn-pressed");
    setTimeout(() => state.btnCopyCrop.classList.remove("btn-pressed"), 2000);
    showToast("Copied to clipboard", "success");
  } catch (err) {
    showToast("Copy failed: " + (err.message || "Unknown error"), "error");
  }
}
