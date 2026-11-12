/* main.js — event listeners, initialization, wiring everything together */

import * as state from "./state-v2.js?v=x54";
import { mutableState } from "./state-v2.js?v=x54";
import * as api from "./api.js?v=x54";
import * as ui from "./ui.js?v=x54";
import * as generate from "./generate.js?v=x54";
import { MAX_SEED } from "./constants.js?v=x54";
import { initQwenTemplates } from "./qwen-templates.js?v=x54";
import { setOutputMode } from "./animation.js?v=x54";
import * as cropper from "./cropper.js?v=x54";
import * as defaults from "./defaults.js?v=x54";
import * as models from "./models.js?v=x54";
import * as postprocess from "./postprocess.js?v=x54";
import { initBridge, sendRender } from "./bridge.js?v=x54";
import { initAdjustments } from "./adjustments.js?v=x54";

/**
 * A finite number from a field, or the fallback.
 *
 * `parseInt("")` / `parseFloat("")` return NaN, and `??` only catches null/undefined — so
 * `parseInt(x) ?? 8` never falls back and an emptied field reaches the server as `null`, which the
 * request model rejects without naming the field.
 */
const num = (v, dflt = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

// ── Inter-app bridge (split wrapper / Prompt Assistant) ──
// initBridge handles the v1 protocol, replies pong, sends a *receipt* for each
// inbound prompt, and exposes sendRender() for reporting finished images back.
// That receipt is what lets the assistant's "Sent" state mean something.
initBridge((prompt) => {
  state.positivePrompt.value = prompt;
  ui.autoResizeTextarea(state.positivePrompt);
  ui.showToast("Prompt received from Prompt Assistant", "success");
  ui.switchTab("prompt");
});

// Report a finished render back to the assistant. Called from generate.js.
export function reportRender(info) {
  sendRender(info);
  // Embedded in the PhotoCraft AI panel (?theme=photocraft): hand the finished picture up to the
  // host, which opens it in PhotoCraft. postMessage, not fetch, so the panel and the engine can sit
  // on different ports without either one needing CORS.
  if (window.parent !== window && info && info.filename) {
    // ComfyUI files can live in a dated subfolder, and /view needs it to find the picture.
    let subfolder = "";
    try { subfolder = new URL(info.url, location.origin).searchParams.get("subfolder") || ""; } catch (e) {}
    window.parent.postMessage({
      type: "photocraft-ai-render",
      filename: info.filename,
      subfolder,
      prompt: (document.getElementById("positivePrompt") || {}).value || "",
      stage: info.stage || 1,
      // Set when the input picture came out of the editor: the panel then puts the render into
      // that same document as a new layer above it, instead of opening a second document.
      from_photocraft: !!renderSource.from_photocraft,
      photocraft_doc: renderSource.doc || "",
    }, "*");
  }
}
window.__ernieReportRender = reportRender;

// ── Theme persistence ──────────────────────
const themeSelect = document.getElementById("themeSelect");
if (themeSelect) {
  if (new URLSearchParams(location.search).get("embed")) document.body.classList.add("embedded");
  // ?theme= is the host's palette when this app is embedded (PhotoCraft AI); it must win over the
  // stored choice, and is not written back.
  const forcedTheme = new URLSearchParams(location.search).get("theme");
  const savedTheme = forcedTheme || localStorage.getItem("ceg_theme");
  if (savedTheme) {
    document.documentElement.dataset.theme = savedTheme;
    themeSelect.value = savedTheme;
  }
  if (forcedTheme) {
    const sel = document.getElementById("themeSelect");
    if (sel) sel.addEventListener("change", () => localStorage.removeItem("ceg_theme"), { once: true });
  }
  themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ceg_theme", theme);
    // Lazy-load non-default font families
    const urls = {
      ember:     "https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700&family=DM+Sans:wght@400;500&display=swap",
      aurora:    "https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&family=Nunito:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap",
      inferno:   "https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700&family=Barlow:wght@400;500;600&display=swap",
    };
    const url = urls[theme];
    if (url && !document.getElementById("font-" + theme)) {
      const link = document.createElement("link");
      link.id = "font-" + theme;
      link.rel = "stylesheet";
      link.href = url;
      document.head.appendChild(link);
    }
  });
}

// ── Init ───────────────────────────────────
api.fetchConfig()
  .then(data => {
    mutableState.config = data;
    if (data.paths) mutableState.configPaths = data.paths;
    if (data.config_defaults) mutableState.configDefaults = data.config_defaults;
    ui.populateSelects(data);
    ui.populateDefaultsSelects(data);
    ui.populatePromptSelects(data);
    ui.populateProfileSelect(data.profiles);
    // Defaults' per-model sub-tabs are built from the registry, not from the HTML.
    models.seedDefaultsTabs(data);
    // Pre-populate prompt fields for the current (T2I) mode
    const initialUnet = data.default_unet;
    const initialMode = state.generationMode.value === "I2I" ? "i2i" : "t2i";
    return api.fetchModels(initialUnet, initialMode)
      .then(d => {
        if (d.status === "ok") {
          mutableState.modelUserSettings[initialUnet] = d;
          ui.applyPromptDefaultsFromModel(initialUnet, initialMode);
        }
      });
  })
  .then(() => {
    // Second then: config + initial model fetched — set up everything
    ui.updatePromptFieldVisibility();
    ui.updateInputImageVisibility();
    updateModelVisibility();
    // The model select only has its saved/default value from here on, and the preset that carries
    // the clip type is one more round-trip away: everything model-dependent is decided after it,
    // otherwise a 2.1 model picked by default opens with the one-image wording.
    ui.applyPreset(state.unetName.value).then(() => {
      updateModelDependentUi();
      generate.renderRefStrip();
    });
    // Auto-save can only be armed now: until this point the fields still hold
    // the bare HTML defaults, and listening earlier would persist those over
    // whatever the user had actually saved.
    ui.initSettingsAutosave();
    // Pre-load all model defaults in background
    if (mutableState.config?.unet_models) {
      mutableState.config.unet_models.forEach(unet => {
        api.fetchModels(unet)
          .then(d => {
            if (d.status === "ok") mutableState.modelUserSettings[unet] = d;
          })
          .catch(() => {}); // background, non-critical
      });
    }
    // Pre-load chain defaults
    api.fetchDefaults({ action: "load", direction: "forward" })
      .then(d => {
        if (d.status === "ok" && d.chain) {
          mutableState.chainDefaults = d.chain;
          mutableState.chainDefaultsDirection = "forward";
        }
      })
      .catch(() => {});
  })
  .catch(() => ui.showToast("Failed to load config", "error"));

// ── Resource gauges ────────────────────────
const gaugeCpuFill = document.querySelector("#gaugeCpu .gauge-fill");
const gaugeCpuVal = document.querySelector("#gaugeCpu .gauge-value");
const gaugeRamFill = document.querySelector("#gaugeRam .gauge-fill");
const gaugeRamVal = document.querySelector("#gaugeRam .gauge-value");
const gaugeGpuFill = document.querySelector("#gaugeGpu .gauge-fill");
const gaugeGpuVal = document.querySelector("#gaugeGpu .gauge-value");

function setGauge(elFill, elVal, pct, label) {
  if (!elFill || !elVal) return;
  elFill.style.width = pct + "%";
  elFill.classList.remove("warn", "danger");
  if (pct >= 90) elFill.classList.add("danger");
  else if (pct >= 70) elFill.classList.add("warn");
  elVal.textContent = Math.round(pct) + "%" + (label ? " " + label : "");
}

function updateGauges() {
  api.fetchStats()
    .then(data => {
      if (data.status !== "ok") return;
      setGauge(gaugeCpuFill, gaugeCpuVal, data.cpu);
      setGauge(gaugeRamFill, gaugeRamVal, data.ram,
        `(${data.ram_used_gb}/${data.ram_total_gb} GB)`);
      setGauge(gaugeGpuFill, gaugeGpuVal, data.gpu_mem,
        `(${data.gpu_mem_used_gb}/${data.gpu_mem_total_gb} GB) · core ${Math.round(data.gpu)}%`);
    })
    .catch(() => {});
}

updateGauges();
setInterval(updateGauges, 2000);

// ── Generation Setup concertina ─────────────────
// Folded by default: the prompt and Generate are the primary interaction and must be reachable in a
// 430 px column without scrolling. The header keeps naming the setup in force, so a shut section
// still answers "what will run?" — and the choice is remembered once the user opens it.
const GEN_SETUP_KEY = "qwen21_genSetupCollapsed";
const genSetupSection = document.getElementById("generationSetupPanel");
const genSetupToggle = document.getElementById("genSetupToggle");
const genSetupBody = document.getElementById("genSetupBody");
const genSetupSummary = document.getElementById("genSetupSummary");

function setGenSetupCollapsed(collapsed, animate) {
  if (!genSetupSection || !genSetupBody) return;
  if (!animate) {
    genSetupBody.style.transition = "none";
    void genSetupBody.offsetHeight; // commit `none` before the class flips
  }
  genSetupSection.classList.toggle("collapsed", collapsed);
  genSetupToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  if (!animate) genSetupBody.style.transition = "";
}

// The one fact worth seeing while the section is shut: mode, model, steps and the shape.
function updateGenSetupSummary() {
  if (!genSetupSummary) return;
  const model = (state.unetName.value || "").replace(/\.(safetensors|gguf|ckpt|pt)$/i, "");
  const steps = state.promptSteps ? state.promptSteps.value : "";
  // Order matters: the header truncates, and steps + shape are the numbers worth keeping — the model
  // name is the one part that can afford to be cut.
  const parts = [
    state.generationMode.value || "T2I",
    steps ? steps + " steps" : "",
    state.arInput ? state.arInput.value : "",
    model,
  ].filter(Boolean);
  genSetupSummary.textContent = parts.join(" · ");
}

if (genSetupToggle) {
  genSetupToggle.addEventListener("click", () => {
    const collapsed = !genSetupSection.classList.contains("collapsed");
    setGenSetupCollapsed(collapsed, true);
    try { localStorage.setItem(GEN_SETUP_KEY, collapsed ? "1" : "0"); } catch (e) {}
  });
  // Programmatic writes (preset applied, defaults restored) fire no events, so the delegated
  // listeners below cover every field the user touches and the model-change path calls the sync
  // explicitly.
  ["input", "change"].forEach(ev =>
    genSetupSection.addEventListener(ev, () => updateGenSetupSummary(), true));
  window.addEventListener("preset-applied", () => updateGenSetupSummary());
  let saved = null;
  try { saved = localStorage.getItem(GEN_SETUP_KEY); } catch (e) {}
  // Absent key = never touched = the default (folded). Present = the user's own decision.
  if (saved !== null) setGenSetupCollapsed(saved === "1", false);
  updateGenSetupSummary();
}

// ── Preset on model change ─────────────────
state.unetName.addEventListener("change", () => {
  const unet = state.unetName.value;
  const mode = state.generationMode.value === "I2I" ? "i2i" : "t2i";

  // Remember the choice so a reload comes back to it.
  ui.saveLastModel(unet);
  // Silence auto-save until the new model's settings have been painted in:
  // the fetch below is async, and the 600ms debounce would otherwise fire
  // first and write the OUTGOING model's values under the incoming name.
  ui.setAutosaveSuspended(true);

  // Always fetch fresh model data for the current mode
  api.fetchModels(unet, mode)
    .then(data => {
      if (data.status !== "ok") return;
      mutableState.modelUserSettings[unet] = data;
      // Populate the visible prompt-tab fields for the chosen model+mode
      ui.applyPromptDefaultsFromModel(unet, mode);
      ui.fillLoras(data.loras || ["none"]);
      // And the preset itself: a model from another family brings its own text encoder, VAE,
      // clip type, sampler and step count. Without this the previous model's pairing stayed on
      // screen, so picking an ERNIE / Z-Image / Krea model silently sampled with the Qwen
      // encoder and VAE.
      // The preset (text encoder, VAE, clip type) arrives asynchronously — wait for it before
      // judging anything model-dependent, or the reference strip, the PhotoCraft checkbox wording
      // and the template button keep describing the previous model.
      ui.updateTitle(unet);
      ui.applyPreset(unet).then(() => {
        // A non-2.1 model sends image 1 only, and the strip has to say so rather than showing
        // layers nobody will receive.
        generate.renderRefStrip();
        updateModelDependentUi();
        updateGenSetupSummary();
      });
    })
    .catch(() => {})
    .finally(() => ui.setAutosaveSuspended(false));
});

// A preset carries the clip type as well, and the 2.1 test looks at both halves: switching only
// the encoder must move the PhotoCraft wording and the template button with it.
if (state.clipType) state.clipType.addEventListener("change", () => updateModelDependentUi());

// ── Random seed ────────────────────────────
state.btnRandomSeed.addEventListener("click", () => {
  state.seed.value = Math.floor(Math.random() * MAX_SEED);
});

// ── Refresh models ─────────────────────────
state.btnRefreshModels.addEventListener("click", () => {
  const unet = state.unetName.value;
  api.fetchModels(unet)
    .then(data => {
      if (data.status === "ok") {
        ui.fillModelSelect(state.unetName, data.unet_info, data.unet_models);
        state.unetName.value = unet;
        ui.fillLoras(data.loras);
        state.status.value = data.message;
        ui.showToast(data.message, "success");
      }
    });
});

// ── Tab switching ──────────────────────────
state.tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    ui.switchTab(tab);
    if (tab === "defaults") defaults.loadDefaultsTab();
    if (tab === "models") models.loadModelsTab();
  });
});

function updateModelVisibility() {
  const isChain = state.generationMode.value === "T2I -> I2I" || state.generationMode.value === "T2I -> I2I (Reversed)" || state.generationMode.value === "T2I -> I2I (Ernie->Krea2)" || state.generationMode.value === "T2I -> I2I (Krea2->Ernie)" || state.generationMode.value === "T2I -> I2I (Ernie->Ernie)";
  if (state.modelSelectWrap) state.modelSelectWrap.style.display = isChain ? "none" : "";
}

// ── Generation mode change ─────────────────
state.generationMode.addEventListener("change", () => {
  const mode = state.generationMode.value;

  ui.updatePromptFieldVisibility();
  ui.updateInputImageVisibility(); // legacy
  ui.updateDimensionVisibility();

  // Populate prompt tab fields with defaults for the selected mode
  ui.applyPromptDefaultsForMode(mode);
  // A mode switch can bring its model preset with it (clip type included), so the button's
  // condition is re-read rather than assumed unchanged.
  updateModelDependentUi();
});

// ── MP input change ────────────────────────
if (state.mpInput) {
  state.mpInput.addEventListener("input", () => {
    if (state.generationMode.value === "I2I" && mutableState.detectedImageAR) {
      ui.updateI2IDimensions();
    } else if (state.generationMode.value === "T2I") {
      ui.recalcDimensions();
    }
  });
}

// ── Image upload ───────────────────────────
state.inputImage.addEventListener("change", () => {
  const file = state.inputImage.files[0];
  if (!file) return;
  renderSource.from_photocraft = false;
  renderSource.doc = "";
  if (state.pcSource) state.pcSource.checked = false;
  // A picture picked from disk carries no layer references: image_2+ came from the editor's layers.
  generate.clearReferences();
  generate.handleImageUpload(file);
});

// ── Clipboard paste ────────────────────────
document.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf("image") !== -1) {
      const file = items[i].getAsFile();
      if (file) {
        e.preventDefault();
        if (!generate.takesImageInput(state.unetName.value, state.clipType && state.clipType.value)) {
          // MOSS-Image pasted into an edit that has no image input: the picture would sit in the
          // panel and never reach the graph, so say so instead of switching mode for nothing.
          ui.showToast("This model writes from text only — no image was added", "error");
          break;
        }
        if (state.generationMode.value !== "I2I") {
          state.generationMode.value = "I2I";
          ui.updateInputImageVisibility();
          ui.updatePromptFieldVisibility();
          ui.updateDimensionVisibility();
          ui.applyPromptDefaultsForMode("I2I");
        }
        renderSource.from_photocraft = false;
        renderSource.doc = "";
        if (state.pcSource) state.pcSource.checked = false;
        generate.handleImageUpload(file);
        ui.showToast("Image pasted from clipboard", "success");
        break;
      }
    }
  }
});

// ── Auto-resize textarea ─────────────────
state.positivePrompt.addEventListener("input", () => ui.autoResizeTextarea(state.positivePrompt));

if (typeof ResizeObserver !== "undefined") {
  const ro = new ResizeObserver(() => ui.autoResizeTextarea(state.positivePrompt));
  ro.observe(state.positivePrompt);
}

// ── Resolve model default (user override > preset > fallback) ──
function resolveModelDefault(unet, field, fallback) {
  const data = mutableState.modelUserSettings[unet];
  if (data?.user_settings && data.user_settings[field] !== undefined) return data.user_settings[field];
  if (data?.preset && data.preset[field] !== undefined) return data.preset[field];
  return fallback;
}

// ── PhotoCraft as the I2I source (inside the panel only) ─────────
// The panel is the only place with an editor to ask, so the checkbox is hidden when the studio
// runs on its own; when it is ticked the file input is disabled, because the picture comes from
// PhotoCraft instead of from disk.
const EMBEDDED = window.parent !== window;
// Where the next render's input came from: cleared whenever a file is chosen or pasted instead.
const renderSource = { from_photocraft: false, doc: "", size: null };
if (state.pcSourceWrap) state.pcSourceWrap.style.display = EMBEDDED ? "flex" : "none";

async function usePhotoCraftSource() {
  state.status.value = "Reading the picture from PhotoCraft…";
  const file = await generate.pullFromPhotoCraft();
  renderSource.from_photocraft = true;
  renderSource.doc = file.photocraftDoc || "";
  renderSource.size = file.photocraftSize || null;
  const ok = await generate.handleImageUpload(file);
  if (!ok) throw new Error("The picture from PhotoCraft could not be uploaded.");
  // image_2 … image_N travel with the same pull: the panel exports the layers named "image 2",
  // "image 3" … so a prompt that says "image 2" points at that layer.
  const refs = await generate.uploadReferenceFiles(file.photocraftRefs || [], file.photocraftIgnored || []);
  const refNote = refs.length
    ? ` + ${refs.map(r => `image ${r.slot}`).join(", ")} from the document's layers`
    : "";
  if (state.inputImage) state.inputImage.value = "";
  state.status.value = `Using the picture open in PhotoCraft (${file.name})${refNote} as image 1.`;
  return file;
}

if (state.pcSource) {
  state.pcSource.addEventListener("change", async () => {
    if (state.inputImage) state.inputImage.disabled = state.pcSource.checked;
    if (!state.pcSource.checked) {
      state.status.value = "Input image: choose a file.";
      return;
    }
    try {
      await usePhotoCraftSource();
      ui.showToast("Picture pulled out of PhotoCraft", "success");
    } catch (e) {
      state.pcSource.checked = false;
      if (state.inputImage) state.inputImage.disabled = false;
      state.status.value = e.message;
      ui.showToast(e.message, "error");
    }
  });
}

// ── Generate ───────────────────────────────
state.btnGenerate.addEventListener("click", async () => {
  generate.setGenerateStatus("");
  const prompt = state.positivePrompt.value.trim();
  if (!prompt) {
    generate.setGenerateStatus("Positive prompt is required");
    return;
  }

  generate.setGenerateStatus("");
  setOutputMode('placeholder');
  state.status.value = "Generation queued...";

  const mode = state.generationMode.value;
  const unet = state.unetName.value;
  // Backstop for a text-only model (MOSS-Image) reaching a queued job: the mode select blocks it,
  // and so does the server, but a job must never be queued that cannot see its own source.
  if (mode === "I2I" && !generate.takesImageInput(unet, state.clipType && state.clipType.value)) {
    const why = "This model writes from text only — switch Generation Mode to T2I";
    state.status.value = why;
    generate.setGenerateStatus(why);
    return;
  }
  // Re-pull at Generate: the document in PhotoCraft may have changed since the box was ticked,
  // and "the picture open in PhotoCraft" has to mean the one open now.
  if (mode === "I2I" && EMBEDDED && state.pcSource && state.pcSource.checked) {
    try {
      await usePhotoCraftSource();
    } catch (e) {
      state.status.value = e.message;
      generate.setGenerateStatus(e.message);
      return;
    }
  }
  if (mode === "I2I" && !mutableState.inputImageFilename) {
    state.status.value = "I2I mode requires an input image";
    generate.setGenerateStatus("I2I mode requires an input image");
    return;
  }

  // Ensure model defaults are loaded
  let modelData = mutableState.modelUserSettings[unet];
  if (!modelData || !modelData.preset) {
    try {
      const modeKey = mode === "I2I" ? "i2i" : "t2i";
      modelData = await api.fetchModels(unet, modeKey);
      if (modelData.status === "ok") mutableState.modelUserSettings[unet] = modelData;
    } catch (e) {
      console.warn("[Generate] Could not fetch model defaults:", e);
    }
  }

  // Snapshot: read every field from the visible prompt-tab inputs
  // (The clip type is read once, before the literal, because the reference gate below needs it:
  //  `snapshot.clip_type` inside the literal that defines `snapshot` is a TDZ ReferenceError.)
  const snapshotClipType = resolveModelDefault(unet, "clip_type", "");
  const snapshot = {
    positive_prompt: prompt,
    unet_name: unet,
    clip_name: resolveModelDefault(unet, "clip_name", ""),
    clip_type: snapshotClipType,
    vae_name: resolveModelDefault(unet, "vae_name", ""),
    lora1_name: state.lora1Name.value || "none",
    lora1_strength: num(state.lora1Strength.value, 0.0),
    lora2_name: state.lora2Name.value || "none",
    lora2_strength: num(state.lora2Strength.value, 0.0),
    sampler: (state.promptSampler && state.promptSampler.value) || resolveModelDefault(unet, "sampler", "euler"),
    scheduler: (state.promptScheduler && state.promptScheduler.value) || resolveModelDefault(unet, "scheduler", "simple"),
    steps: Math.round(num(state.promptSteps?.value, resolveModelDefault(unet, "steps", 8))),
    cfg: num(state.promptCFG?.value, resolveModelDefault(unet, "cfg", 1.0)),
    denoise: num(state.denoise.value, 1.0),
    generation_mode: mode,
    seed: state.seed.value,
    input_image_filename: mutableState.inputImageFilename,
    // image_2 … image_N, already uploaded by the PhotoCraft pull (empty for a disk file). Only the
    // 2.1 encoder has those slots, so a Krea/ERNIE/Z-Image edit sends image 1 and nothing else —
    // the server refuses references on any other model, and this never asks it to.
    reference_images: generate.supportsReferences(unet, snapshotClipType)
      ? (mutableState.referenceFilenames || []).map(r => r.filename)
      : [],
    pag_scale: num(state.promptPAG?.value, resolveModelDefault(unet, "pag_scale", 0.0)),
  };

  // Resolve dimensions from the visible prompt-tab inputs
  if (mode === "T2I") {
    const mp = num(state.mpInput.value, 1.54);
    const ar = state.arInput.value || "9:16";
    snapshot.dimension_mode = "MP + AR";
    snapshot.mp = mp;
    snapshot.ar = ar;
    const arVal = ui.parseAspectRatio(ar);
    [snapshot.width, snapshot.height] = ui.calcDimensions(mp, arVal);
  } else if (mode === "I2I") {
    snapshot.dimension_mode = "MP + AR";
    snapshot.mp = num(state.mpInput.value, 1.54);
    // The exact detected ratio, not the rounded "9:16" label: calcDimensions floors to multiples of
    // 64, and the label alone loses enough to change the result.
    const exactAR = mutableState.detectedImageAR || ui.parseAspectRatio(state.arInput.value || "9:16");
    snapshot.ar = state.arInput.value || "9:16";
    [snapshot.width, snapshot.height] = ui.calcDimensions(snapshot.mp, exactAR);
    // An I2I picture has a source of known size. Unless the user asked for a different megapixel
    // count, render at exactly that size ("Direct" — "MP + AR" would floor it to multiples of 64
    // and a delivered layer would leave a strip of the picture underneath showing).
    const srcSize = mutableState.sourceImageSize;
    const srcMP = srcSize ? (srcSize[0] * srcSize[1]) / 1e6 : 0;
    if (srcSize && Math.abs(snapshot.mp - srcMP) / srcMP < 0.02) {
      snapshot.dimension_mode = "Direct";
      snapshot.width = srcSize[0];
      snapshot.height = srcSize[1];
      snapshot.mp = +srcMP.toFixed(3);
      snapshot.ar = `${srcSize[0]}:${srcSize[1]}`;
    }
    // The canvas an I2I job samples at is not free-form: the VAEs floor the latent to a
    // multiple of 8 and Qwen 2.1's encoder returns the edit latent at the reference's own
    // size rounded to 32, so 32 is the grid both accept. Snap before submitting, then hand
    // the server those exact pixels (below) so the field, the job card and the file all agree.
    [snapshot.width, snapshot.height] = ui.snapI2IDims(snapshot.width, snapshot.height);
    // Submit the pixels, not "MP + AR". The server recomputes that mode from the mp and the
    // ar *string*, and the string is a rounded label ("9:16" for a source that is really
    // 0.600), so it could render a different size than the one just computed and shown —
    // a card reading 960×1600 submitted as 896×1600. I2I always knows its exact size.
    snapshot.dimension_mode = "Direct";
  }

  const job = {
    id: mutableState.nextJobId++,
    status: "waiting",
    snapshot: snapshot,
    timestamp: Date.now(),
  };

  // T2I -> I2I chain modes
  if (mode === "T2I -> I2I" || mode === "T2I -> I2I (Reversed)" || mode === "T2I -> I2I (Ernie->Krea2)" || mode === "T2I -> I2I (Krea2->Ernie)" || mode === "T2I -> I2I (Ernie->Ernie)") {
    const reversed = mode === "T2I -> I2I (Reversed)";
    const ernieToKrea2 = mode === "T2I -> I2I (Ernie->Krea2)";
    const krea2ToErnie = mode === "T2I -> I2I (Krea2->Ernie)";
    const ernieUpscale = mode === "T2I -> I2I (Ernie->Ernie)";
    const cd = mutableState.chainDefaults || {};

    // Resolve effective stage configs.
    // Phase 1 is always T2I, Phase 2 is always I2I. The direction only affects
    // which model runs in each phase (hardcoded below). Do NOT swap stage1/stage2
    // between phases — it would swap mode-specific params (denoise) too.
    let stage1Config = cd.stage1 || {};
    let stage2Config = cd.stage2 || {};
    // If no chain defaults, bootstrap from server presets (fallback hardcoded values below)

    if (ernieUpscale) {
      // Stage 1: Ernie T2I (same as reversed/ernieToKrea2)
      job.snapshot.generation_mode = "T2I";
      job.snapshot.unet_name = "ernie-image-turbo.safetensors";
      job.snapshot.clip_name = "ministral-3-3b.safetensors";
      job.snapshot.clip_type = "flux2";
      job.snapshot.vae_name = "flux2-vae.safetensors";
    } else if (krea2ToErnie) {
      // Stage 1: Krea-2 T2I
      job.snapshot.generation_mode = "T2I";
      job.snapshot.unet_name = "krea2_turbo_fp8_scaled.safetensors";
      job.snapshot.clip_name = "qwen3vl_4b_fp8_scaled.safetensors";
      job.snapshot.clip_type = "krea2";
      job.snapshot.vae_name = "qwen_image_vae.safetensors";
    } else if (reversed || ernieToKrea2) {
      // Stage 1: Ernie T2I
      job.snapshot.generation_mode = "T2I";
      job.snapshot.unet_name = "ernie-image-turbo.safetensors";
      job.snapshot.clip_name = "ministral-3-3b.safetensors";
      job.snapshot.clip_type = "flux2";
      job.snapshot.vae_name = "flux2-vae.safetensors";
    } else {
      // Stage 1: z-image turbo T2I
      job.snapshot.generation_mode = "T2I";
      job.snapshot.unet_name = "z_image_turbo_bf16.safetensors";
      job.snapshot.clip_name = "qwen_3_4b.safetensors";
      job.snapshot.clip_type = "lumina2";
      job.snapshot.vae_name = "Turbo_z_ae.safetensors";
    }

    // Stage 1 parameters — read from Phase 1 panel (user may have tweaked them)
    job.snapshot.sampler = (state.chainPromptP1Sampler && state.chainPromptP1Sampler.value) || stage1Config.sampler || "euler";
    job.snapshot.scheduler = (state.chainPromptP1Scheduler && state.chainPromptP1Scheduler.value) || stage1Config.scheduler || "simple";
    job.snapshot.steps = parseInt(state.chainPromptP1Steps?.value) ?? stage1Config.steps ?? 8;
    job.snapshot.cfg = parseFloat(state.chainPromptP1CFG?.value) ?? stage1Config.cfg ?? 1.0;
    job.snapshot.denoise = parseFloat(state.chainPromptP1Denoise?.value) ?? stage1Config.denoise ?? 1.0;
    job.snapshot.mp = parseFloat(state.chainPromptP1MP?.value) ?? stage1Config.mp ?? 1.54;
    job.snapshot.ar = (state.chainPromptP1AR?.value) || stage1Config.ar || "9:16";
    job.snapshot.lora1_name = (state.chainPromptP1Lora1Name?.value) || stage1Config.lora1_name || "none";
    job.snapshot.lora1_strength = parseFloat(state.chainPromptP1Lora1Strength?.value) ?? stage1Config.lora1_strength ?? 0.0;
    job.snapshot.lora2_name = (state.chainPromptP1Lora2Name?.value) || stage1Config.lora2_name || "none";
    job.snapshot.lora2_strength = parseFloat(state.chainPromptP1Lora2Strength?.value) ?? stage1Config.lora2_strength ?? 0.0;
    job.snapshot.seed = state.seed.value;

    job.snapshot.dimension_mode = "MP + AR";
    const ar = ui.parseAspectRatio(job.snapshot.ar);
    [job.snapshot.width, job.snapshot.height] = ui.calcDimensions(parseFloat(job.snapshot.mp) || 1.54, ar);

    // Store the effective stage2 config SO THAT deferStage2/flushDeferredStage2 use live panel values
    job.chainConfig = {
      stage2: {
        generation_mode: "I2I",
        reversed: reversed,
        ernieToKrea2: ernieToKrea2,
        krea2ToErnie: krea2ToErnie,
        ernieUpscale: ernieUpscale,
        _effectiveStage2: stage2Config,
        // Capture live Phase 2 panel overrides (user may have tweaked them)
        sampler: (state.chainPromptP2Sampler && state.chainPromptP2Sampler.value) || stage2Config.sampler || "euler",
        scheduler: (state.chainPromptP2Scheduler && state.chainPromptP2Scheduler.value) || stage2Config.scheduler || "simple",
        steps: parseInt(state.chainPromptP2Steps?.value) ?? stage2Config.steps ?? 8,
        cfg: parseFloat(state.chainPromptP2CFG?.value) ?? stage2Config.cfg ?? 1.0,
        denoise: parseFloat(state.chainPromptP2Denoise?.value) ?? stage2Config.denoise ?? 0.5,
        upscale: (() => {
          const p1MP = parseFloat(state.chainPromptP1MP?.value) ?? stage1Config.mp ?? 1.54;
          const p2TargetMP = parseFloat(state.chainPromptP2TargetMP?.value) ?? p1MP;
          return Math.sqrt(p2TargetMP / p1MP);
        })(),
        lora1_name: (state.chainPromptP2Lora1Name?.value) || stage2Config.lora1_name || "none",
        lora1_strength: parseFloat(state.chainPromptP2Lora1Strength?.value) ?? stage2Config.lora1_strength ?? 0.0,
        lora2_name: (state.chainPromptP2Lora2Name?.value) || stage2Config.lora2_name || "none",
        lora2_strength: parseFloat(state.chainPromptP2Lora2Strength?.value) ?? stage2Config.lora2_strength ?? 0.0,
      }
    };
    job.snapshot.upscale = job.chainConfig.stage2.upscale;
    mutableState.activeT2ICount++;
    console.log("[CHAIN] Created chain job", job.id, "reversed:", reversed, "ernieToKrea2:", ernieToKrea2, "krea2ToErnie:", krea2ToErnie, "ernieUpscale:", ernieUpscale, "chainConfig:", job.chainConfig);
  }

  mutableState.jobQueue.push(job);
  generate.renderQueue();

  // The Output tab is gone — a finished render is announced to PhotoCraft AI and opened there, so
  // there is nothing to show here. Progress stays visible on every tab: the queue strips under the
  // status field and the Generate bar's status text.

  generate.processQueue();
});

// ── Open image browser (separate tab) ───────
// The button lived in the Output tab, so this never runs now; guarded the way #btnView100 is, so the
// module still loads when the element is absent.
if (state.btnOpenOutput) state.btnOpenOutput.addEventListener("click", () => {
  // Open the tab synchronously, inside the click handler — a window.open() after
  // an await/fetch is treated as a popup and blocked by the browser.
  let tab = null;
  try { tab = window.open("", "_blank"); } catch (_e) { tab = null; }

  if (tab) {
    // Placeholder page that waits for the Image Browser to answer, then goes there.
    // Without this the new tab shows "connection refused" while Flask boots.
    tab.document.write(
      "<!doctype html><title>Opening Image Browser…</title>" +
      "<body style=\"margin:0;display:flex;align-items:center;justify-content:center;" +
      "height:100vh;background:#0d0d12;color:#cfc9ff;" +
      "font:14px system-ui,sans-serif\">Starting Image Browser…</body>"
    );
  }

  state.status.value = "Opening Image Browser…";

  const fail = (msg) => {
    if (tab) { try { tab.close(); } catch (_e) {} }
    state.status.value = msg;
    ui.showToast(msg, "error");
  };

  api.openOutput()
    .then(data => {
      if (data.status !== "ok" || !data.url) {
        return fail(data.message || "Could not open Image Browser");
      }
      state.status.value = data.message;
      if (!tab) {
        // Popup blocked — fall back to navigating this tab.
        window.location.href = data.url;
        return;
      }
      const target = data.url;
      const deadline = Date.now() + 30000;
      const ping = () => {
        if (Date.now() > deadline) {
          tab.close();
          state.status.value = "Image Browser did not respond";
          ui.showToast("Image Browser did not respond", "error");
          return;
        }
        // no-cors: opaque response on any HTTP answer, rejects while the port is shut.
        fetch(target, { mode: "no-cors", cache: "no-store" })
          .then(() => { tab.location.replace(target); })
          .catch(() => setTimeout(ping, 700));
      };
      ping();
    })
    .catch(err => fail("Error: " + err.message));
});

// ── Qwen prompt templates ──────────────────
// Fourteen proven Qwen-Image 2.1 edit prompts, one example each, behind a button that only exists
// while that model is selected: the list is the model's own idiom, and every other family would
// just be handed a prompt written for a different encoder. Picking an entry replaces the prompt
// (the button means "use this one") and shuts the menu again.
const qwenTemplates = initQwenTemplates({
  btn: state.btnQwenTemplates,
  menu: state.qwenTplMenu,
  onPick(tpl) {
    const ta = state.positivePrompt;
    if (!ta) return;
    ta.value = tpl.prompt;
    ta.focus();
    ta.setSelectionRange(tpl.prompt.length, tpl.prompt.length);
    // Autosave and the setup summary listen for these; setting .value alone leaves both stale.
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    const need = tpl.images > 1 ? `image 1 + image ${tpl.images === 2 ? "2" : `2–${tpl.images}`}` : "one image";
    state.status.value = `Template ${tpl.n} · ${tpl.title} — its example uses ${need}.`;
  },
});

// Everything that depends on the selected model rather than on the mode. One test decides all of
// it: whether the run can take the extra reference layers (Qwen-Image 2.1 only), so the template
// button and the PhotoCraft checkbox wording can never disagree with what the server will accept.
function updateModelDependentUi() {
  const unetNow = state.unetName && state.unetName.value;
  const clipNow = state.clipType && state.clipType.value;
  const refs = generate.supportsReferences(unetNow, clipNow);
  qwenTemplates.setVisible(refs);

  // Text-only models (MOSS-Image) cannot run I2I: the picture would be uploaded and then never
  // reach the graph. The option is disabled rather than silently failing, and a mode left over
  // from the previous model falls back to T2I with a line saying why.
  const takesImage = generate.takesImageInput(unetNow, clipNow);
  const i2iOption = state.generationMode && state.generationMode.querySelector('option[value="I2I"]');
  if (i2iOption) {
    i2iOption.disabled = !takesImage;
    i2iOption.textContent = takesImage ? "I2I" : "I2I (no image input)";
  }
  if (!takesImage && state.generationMode.value === "I2I") {
    state.generationMode.value = "T2I";
    ui.updatePromptFieldVisibility();
    ui.updateDimensionVisibility();
    ui.applyPromptDefaultsForMode("T2I");
    // A family name reads better than the checkpoint filename in a 430 px column.
    const label = clipNow === "moss_image"
      ? "MOSS-Image"
      : String(unetNow || "This model").replace(/\.(safetensors|gguf|ckpt|pt)$/i, "");
    state.status.value = `${label} writes from text only — switched to T2I.`;
  }
  if (state.pcSourceLabel) {
    state.pcSourceLabel.textContent = refs
      ? "Use the layers named image 1, image 2 … in PhotoCraft"
      : "Use the layer named image 1 in PhotoCraft";
    // One picture only: say what the names mean for this model, so a document with image 2/3
    // layers does not look like it will send them.
    state.pcSourceLabel.title = refs
      ? "image 1 is the picture, image 2 and image 3 are layers of the same document sent as references"
      : "This model takes one picture: image 1 is the whole picture, layers named image 2 and image 3 are not sent";
  }
}
updateModelDependentUi();

// ── Paste into the prompt ───────────────────
// Reads the clipboard straight into #positivePrompt at the caret, behaving like a real paste:
// the selection (or the insertion point) is replaced, not the whole prompt. Chromium only exposes
// the clipboard API in a secure context and to a frame the host allows (see the panel's iframe
// `allow=`) — over plain http on a LAN address it is simply absent, so say so and put the caret
// back in the field rather than failing silently.
if (state.btnPastePrompt) {
  state.btnPastePrompt.addEventListener("click", async () => {
    const ta = state.positivePrompt;
    if (!ta) return;
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      ta.focus();
      state.status.value = "Clipboard needs https or localhost — press Ctrl+V in the prompt";
      return;
    }
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      ta.focus();
      state.status.value = "The browser blocked the clipboard — press Ctrl+V in the prompt";
      return;
    }
    if (!text) {
      ta.focus();
      state.status.value = "The clipboard is empty";
      return;
    }
    // Replace, do not merge: the button answers "put this in the prompt", so the old text goes. A
    // caret insert is still available the normal way — Ctrl+V in the field.
    ta.value = text;
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    state.status.value = `Pasted ${text.length} characters from the clipboard`;
  });
}

// ── Reset prompt tab to defaults ─────────────
if (state.btnResetPrompt) {
  state.btnResetPrompt.addEventListener("click", () => {
    ui.resetPromptTabToDefaults();
  });
}

// ── Cursor glow ────────────────────────────
document.addEventListener("mousemove", (e) => {
  ui.moveCursorGlow(e.clientX, e.clientY);
  if (mutableState.cursorTimeout) clearTimeout(mutableState.cursorTimeout);
  mutableState.cursorTimeout = setTimeout(() => {
    ui.hideCursorGlow();
  }, 1000);
});

// ── Sticky header offset ───────────────────
// The topbar is sticky and the sub-tab bar pins beneath it. Its height
// varies (font loading, narrow screens), so measure it rather than hardcoding
// the offsets in CSS.
function syncTopbarHeight() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  document.documentElement.style.setProperty(
    "--topbar-h", Math.round(topbar.getBoundingClientRect().height) + "px"
  );
}
syncTopbarHeight();
window.addEventListener("resize", syncTopbarHeight);
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(syncTopbarHeight);
}

// ── Image Cropper ──────────────────────────
if (state.cropperCanvas) {
  state.cropperCanvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const pos = cropper.getMousePos(e);
    const r = cropper.constrainRect(mutableState.cropStart.x, mutableState.cropStart.y, mutableState.cropEnd.x, mutableState.cropEnd.y);
    if (r.w > 0 && r.h > 0 && cropper.pointInRect(pos.x, pos.y, r.x, r.y, r.w, r.h)) {
      mutableState.isDragging = true;
      mutableState.dragStartMouse = { x: pos.x, y: pos.y };
      mutableState.dragStartRect = { x: r.x, y: r.y, w: r.w, h: r.h };
    } else {
      mutableState.isDrawing = true;
      mutableState.cropStart = { x: pos.x, y: pos.y };
      mutableState.cropEnd = { x: pos.x, y: pos.y };
    }
    state.cropperPreviewPanel.classList.add("hidden");
    cropper.drawCropOverlay();
  });

  state.cropperCanvas.addEventListener("mousemove", (e) => {
    if (mutableState.isDrawing) {
      const pos = cropper.getMousePos(e);
      mutableState.cropEnd = { x: pos.x, y: pos.y };
      cropper.drawCropOverlay();
    } else if (mutableState.isDragging) {
      const pos = cropper.getMousePos(e);
      const dx = pos.x - mutableState.dragStartMouse.x;
      const dy = pos.y - mutableState.dragStartMouse.y;
      mutableState.cropStart = { x: mutableState.dragStartRect.x + dx, y: mutableState.dragStartRect.y + dy };
      mutableState.cropEnd = { x: mutableState.dragStartRect.x + mutableState.dragStartRect.w + dx, y: mutableState.dragStartRect.y + mutableState.dragStartRect.h + dy };
      cropper.drawCropOverlay();
    }
  });

  state.cropperCanvas.addEventListener("mouseup", cropper.endCrop);
  state.cropperCanvas.addEventListener("mouseleave", cropper.endCrop);
}

if (state.btnView100) state.btnView100.addEventListener("click", cropper.openCropper);
if (state.btnCropperClose) state.btnCropperClose.addEventListener("click", cropper.closeCropper);
if (state.cropperBackdrop) state.cropperBackdrop.addEventListener("click", cropper.closeCropper);
if (state.cropperAR) state.cropperAR.addEventListener("change", () => {
  if (!mutableState.isDrawing) cropper.drawCropOverlay();
});
if (state.btnCopyCrop) {
  state.btnCopyCrop.addEventListener("click", cropper.copyCropToClipboard);
}

// ── Defaults Tab Logic ─────────────────────
// The model sub-tabs are built from the registry (js/models.js) after /api/config answers, so
// these are delegated rather than bound to the buttons that happened to exist at load.
const defaultsTabBar = document.getElementById("defaultsModelTabs");
if (defaultsTabBar) {
  defaultsTabBar.addEventListener("click", (event) => {
    const btn = event.target.closest(".sub-tab-btn");
    if (!btn) return;
    defaultsTabBar.querySelectorAll(".sub-tab-btn").forEach(b => b.classList.toggle("active", b === btn));
    defaults.loadDefaultsTab();
  });
}

state.defaultsMode.addEventListener("change", defaults.loadDefaultsTab);
if (state.chainDirection) state.chainDirection.addEventListener("change", defaults.loadDefaultsTab);
if (state.btnSaveDefaults) state.btnSaveDefaults.addEventListener("click", defaults.saveDefaults);
if (state.btnResetDefaults) state.btnResetDefaults.addEventListener("click", defaults.resetDefaults);
// Paths moved to the Models tab (js/models.js owns those fields).
models.bindModelsTab();

// Bind range value displays in Prompt tab
ui.bindRange(state.denoise, state.denoiseVal);
ui.bindRange(state.lora1Strength, state.lora1StrengthVal);
ui.bindRange(state.lora2Strength, state.lora2StrengthVal);
if (state.promptSteps) ui.bindRange(state.promptSteps, state.promptStepsVal);
if (state.promptCFG) ui.bindRange(state.promptCFG, state.promptCFGVal);
if (state.promptPAG) ui.bindRange(state.promptPAG, state.promptPAGVal);

// Sampling profile selector: applying a profile writes the four sampling
// fields; editing any of them by hand flips the selector to Custom.
if (state.promptProfile) {
  state.promptProfile.addEventListener("change", () => {
    ui.applyProfile(state.promptProfile.value);
  });
  [state.promptSampler, state.promptScheduler, state.promptSteps, state.promptCFG]
    .forEach(el => {
      if (!el) return;
      el.addEventListener(el === state.promptSteps || el === state.promptCFG ? "input" : "change",
        () => { state.promptProfile.value = ui.detectProfile(); });
    });
}
// Bind range value displays in Defaults tab
ui.bindRange(state.defaultsSteps, state.defaultsStepsVal);
ui.bindRange(state.defaultsCFG, state.defaultsCFGVal);
ui.bindRange(state.defaultsDenoise, state.defaultsDenoiseVal);
ui.bindRange(state.defaultsLora1Strength, state.defaultsLora1StrengthVal);
ui.bindRange(state.defaultsLora2Strength, state.defaultsLora2StrengthVal);
if (state.chainStage1Denoise) ui.bindRange(state.chainStage1Denoise, state.chainStage1DenoiseVal);
if (state.chainStage2Denoise) ui.bindRange(state.chainStage2Denoise, state.chainStage2DenoiseVal);
if (state.chainUpscale) ui.bindRange(state.chainUpscale, state.chainUpscaleVal);
if (state.chainStage1Steps) ui.bindRange(state.chainStage1Steps, state.chainStage1StepsVal);
if (state.chainStage1CFG) ui.bindRange(state.chainStage1CFG, state.chainStage1CFGVal);
if (state.chainStage2Steps) ui.bindRange(state.chainStage2Steps, state.chainStage2StepsVal);
if (state.chainStage2CFG) ui.bindRange(state.chainStage2CFG, state.chainStage2CFGVal);
if (state.chainStage1Lora1Strength) ui.bindRange(state.chainStage1Lora1Strength, state.chainStage1Lora1StrengthVal);
if (state.chainStage1Lora2Strength) ui.bindRange(state.chainStage1Lora2Strength, state.chainStage1Lora2StrengthVal);
if (state.chainStage2Lora1Strength) ui.bindRange(state.chainStage2Lora1Strength, state.chainStage2Lora1StrengthVal);
if (state.chainStage2Lora2Strength) ui.bindRange(state.chainStage2Lora2Strength, state.chainStage2Lora2StrengthVal);
// Prompt tab Phase 1 / Phase 2 ranges
if (state.chainPromptP1Steps) ui.bindRange(state.chainPromptP1Steps, state.chainPromptP1StepsVal);
if (state.chainPromptP1CFG) ui.bindRange(state.chainPromptP1CFG, state.chainPromptP1CFGVal);
if (state.chainPromptP1Denoise) ui.bindRange(state.chainPromptP1Denoise, state.chainPromptP1DenoiseVal);
if (state.chainPromptP1Lora1Strength) ui.bindRange(state.chainPromptP1Lora1Strength, state.chainPromptP1Lora1StrengthVal);
if (state.chainPromptP1Lora2Strength) ui.bindRange(state.chainPromptP1Lora2Strength, state.chainPromptP1Lora2StrengthVal);
if (state.chainPromptP2Steps) ui.bindRange(state.chainPromptP2Steps, state.chainPromptP2StepsVal);
if (state.chainPromptP2CFG) ui.bindRange(state.chainPromptP2CFG, state.chainPromptP2CFGVal);
if (state.chainPromptP2Denoise) ui.bindRange(state.chainPromptP2Denoise, state.chainPromptP2DenoiseVal);
if (state.chainPromptP2Lora1Strength) ui.bindRange(state.chainPromptP2Lora1Strength, state.chainPromptP2Lora1StrengthVal);
if (state.chainPromptP2Lora2Strength) ui.bindRange(state.chainPromptP2Lora2Strength, state.chainPromptP2Lora2StrengthVal);

// ── Post-processing: Vibrance / Curves layers in the picture open in PhotoCraft ──
initAdjustments();

// ── Post-Process bindings ──────────────────
postprocess.bindPostProcessRanges();
postprocess.bindPostProcessToggle();
if (state.btnApplyPostProcess) state.btnApplyPostProcess.addEventListener("click", postprocess.applyPostProcess);
if (state.btnResetPostProcess) state.btnResetPostProcess.addEventListener("click", postprocess.resetPostProcess);
// Always default toggle OFF — sliders stay at their restored/persisted positions
if (state.ppEnabled) state.ppEnabled.checked = false;
postprocess.updateToggleUI?.();
postprocess.restoreOriginalImage?.();
