/* api.js — fetch wrappers for every /api/* endpoint */

export function fetchConfig() {
  return fetch("/api/config").then(r => r.json());
}

export function fetchModels(unet, mode) {
  let url = `/api/models?current_unet=${encodeURIComponent(unet)}`;
  if (mode) url += `&mode=${encodeURIComponent(mode)}`;
  return fetch(url).then(r => r.json());
}

export function saveSettings(body) {
  return fetch("/api/save_settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

export function calcDimensionsApi(mp, ar) {
  return fetch("/api/calc_dimensions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mp, ar }),
  }).then(r => r.json());
}

export function uploadImage(formData) {
  return fetch("/api/upload_image", {
    method: "POST",
    body: formData,
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { status: "error", message: data.message || `HTTP ${r.status}` };
    }
    return data;
  });
}

// image_2 … image_N: the same upload, but the server caps the pixels (~1 MP) because a reference
// is a vision slot + a VAE latent, not the canvas.
export function uploadReference(formData, slot) {
  return fetch(`/api/upload_reference?slot=${encodeURIComponent(slot)}`, {
    method: "POST",
    body: formData,
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { status: "error", message: data.message || `HTTP ${r.status}` };
    }
    return data;
  });
}

export function generateImage(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);
  return fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).then(r => {
    clearTimeout(timeoutId);
    return r.json();
  });
}

export function fetchStatus(prompt_id) {
  return fetch(`/api/status?prompt_id=${encodeURIComponent(prompt_id)}`).then(r => r.json());
}

export function openOutput() {
  return fetch("/api/open_output").then(r => r.json());
}

export function fetchDefaults(body) {
  return fetch("/api/defaults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

export function fetchStats() {
  return fetch("/api/stats").then(r => r.json());
}

export function fetchSystemSettings() {
  return fetch("/api/system_settings").then(r => r.json());
}

export function saveSystemSettings(body) {
  return fetch("/api/system_settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

export function processImage(params) {
  return fetch("/api/process_image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then(r => r.json());
}

// ── Model registry (Models tab) ────────────────────────────────────
export function fetchRegistry() {
  return fetch("/api/registry").then(r => r.json());
}

export function saveRegistry(body) {
  return fetch("/api/registry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { status: "error", message: data.message || `HTTP ${r.status}`, ...data };
    return data;
  });
}

export function detectComfy() {
  return fetch("/api/detect_comfy", { method: "POST" }).then(r => r.json());
}
