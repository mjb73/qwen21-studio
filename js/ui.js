/* ui.js — helper functions (toast, autoResizeTextarea, bindRange, cursor glow, tab switching, etc.) */

import * as state from "./state-v2.js?v=x54";
import { mutableState } from "./state-v2.js?v=x54";
import { fetchModels, saveSettings, fetchDefaults } from "./api.js?v=x54";
import { parseAspectRatio, calcDimensions, formatAR, updateI2IDimensions, recalcDimensions, snapI2IDims } from "./dimensions.js?v=x54";
import { updateDimensionVisibility } from "./dimensions.js?v=x54";
import { DEFAULT_MP, QWEN21_NATIVE_MP } from "./constants.js?v=x54";

export { parseAspectRatio, calcDimensions, formatAR, updateI2IDimensions, recalcDimensions, updateDimensionVisibility, snapI2IDims };


export function abbreviateModel(name) {
  if (!name) return "?";
  return name.replace(/\.safetensors$/, "").replace(/\.ckpt$/, "").slice(0, 18);
}

export function fillSelect(sel, options) {
  sel.innerHTML = "";
  options.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = opt;
    sel.appendChild(option);
  });
}

/**
 * Fill a unet <select> from the server's model list, grouped by the loader node
 * each file needs.
 *
 * The 2.1 stack carries both GGUF quants (UnetLoaderGGUF, no weight_dtype) and
 * .safetensors diffusion models (core UNETLoader) and they are not
 * interchangeable, so the two families must never be flattened into one run of
 * anonymous filenames. `info` is the richer list from /api/config|/api/models
 * ([{name, kind, loader, size_gb}]); when it is absent (older server), the
 * extension is used and every entry lands in its correct group anyway.
 */
export function fillModelSelect(sel, info, fallbackNames) {
  const models = (Array.isArray(info) && info.length) ? info
    : (fallbackNames || []).map(n => ({
        name: n,
        kind: /\.gguf$/i.test(n) ? "gguf" : "safetensors",
        size_gb: null,
      }));
  sel.innerHTML = "";
  const groups = [
    { kind: "gguf", label: "GGUF (UnetLoaderGGUF)" },
    { kind: "safetensors", label: "Diffusion model (UNETLoader)" },
  ];
  groups.forEach(g => {
    const inGroup = models.filter(m => (m.kind || "safetensors") === g.kind);
    if (!inGroup.length) return;
    const og = document.createElement("optgroup");
    og.label = g.label;
    inGroup.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = m.name.replace(/\.(gguf|safetensors)$/, "")
        + (m.size_gb ? `  (${m.size_gb} GB)` : "");
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
}

export function populateProfileSelect(profiles) {
  const sel = state.promptProfile;
  if (!sel) return;
  sel.innerHTML = "";
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom";
  sel.appendChild(custom);
  for (const [key, p] of Object.entries(profiles || {})) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = p.label || key;
    if (p.note) opt.title = p.note;
    sel.appendChild(opt);
  }
  sel.value = "custom";
}

/** Apply a named sampling profile to the Prompt tab's four sampling fields. */
export function applyProfile(key) {
  const profiles = mutableState.config?.profiles || {};
  const p = profiles[key];
  if (!p) return false;
  if (state.promptSampler && p.sampler) state.promptSampler.value = p.sampler;
  if (state.promptScheduler && p.scheduler) state.promptScheduler.value = p.scheduler;
  if (state.promptSteps && p.steps != null) {
    state.promptSteps.value = p.steps;
    state.promptStepsVal.textContent = p.steps;
  }
  if (state.promptCFG && p.cfg != null) {
    state.promptCFG.value = p.cfg;
    state.promptCFGVal.textContent = p.cfg;
  }
  return true;
}

/** Which profile, if any, matches the current sampler/scheduler/steps/CFG. */
export function detectProfile() {
  const profiles = mutableState.config?.profiles || {};
  const cur = {
    sampler: state.promptSampler?.value,
    scheduler: state.promptScheduler?.value,
    steps: Number(state.promptSteps?.value),
    cfg: Number(state.promptCFG?.value),
  };
  for (const [key, p] of Object.entries(profiles)) {
    if (p.sampler === cur.sampler && p.scheduler === cur.scheduler &&
        Number(p.steps) === cur.steps && Number(p.cfg) === cur.cfg) {
      return key;
    }
  }
  return "custom";
}

export function fillLoras(loras) {
  const current1 = state.lora1Name.value;
  const current2 = state.lora2Name.value;
  fillSelect(state.lora1Name, loras);
  fillSelect(state.lora2Name, loras);
  if (loras.includes(current1)) state.lora1Name.value = current1;
  else state.lora1Name.value = loras[1] || "none";
  if (loras.includes(current2)) state.lora2Name.value = current2;
  else state.lora2Name.value = "none";
}

export function bindRange(input, display) {
  input.addEventListener("input", () => {
    display.textContent = input.value;
  });
}

export function showToast(message, type) {
  if (mutableState.toastTimeout) clearTimeout(mutableState.toastTimeout);
  state.toast.textContent = message;
  state.toast.className = "toast " + type;
  mutableState.toastTimeout = setTimeout(() => {
    state.toast.classList.add("hidden");
    mutableState.toastTimeout = null;
  }, 3000);
}

export function autoResizeTextarea(el) {
  el.style.height = "auto";
  const minH = 160;
  const h = Math.max(el.scrollHeight, minH);
  el.style.height = h + "px";
}

/** True for Qwen-Image 2.1 checkpoints (any quant / loader). */
export function isQwen21(unet) {
  const n = String(unet || "").toLowerCase();
  return n.includes("qwen_image_2.1") || n.includes("qwen-image-2.1");
}


export function updateTitle(unet) {
  const lower = unet.toLowerCase();
  let title = "ComfyUI Generator";
  if (lower.includes("z-anime") || lower.includes("z_anime")) title = "ComfyUI Z-Anime Generator";
  else if (lower.includes("z-image") || lower.includes("z_image")) title = "ComfyUI Z-Image Generator";
  else if (lower.includes("krea")) title = "ComfyUI Krea-2 Generator";
  else if (lower.includes("ernie")) title = "ComfyUI Ernie Generator";
  else if (lower.includes("qwen") && lower.includes("2.1")) title = "Qwen-Image 2.1 Studio";
  state.appTitle.textContent = title;
  document.title = title;
}

export function populateSelects(data) {
  fillModelSelect(state.unetName, data.unet_info, data.unet_models);
  fillSelect(state.clipName, data.clip_models);
  fillSelect(state.clipType, data.clip_types);
  fillSelect(state.vaeName, data.vae_models);
  fillSelect(state.sampler, data.samplers);
  fillSelect(state.scheduler, data.schedulers);

  state.unetName.value = data.default_unet;
  if (data.preset) {
    state.clipName.value = data.preset.clip_name;
    state.clipType.value = data.preset.clip_type;
    state.vaeName.value = data.preset.vae_name;
    state.sampler.value = data.preset.sampler;
    state.scheduler.value = data.preset.scheduler;
    state.steps.value = data.preset.steps;
    state.stepsVal.textContent = data.preset.steps;
    state.cfg.value = data.preset.cfg;
    state.cfgVal.textContent = data.preset.cfg;
    state.width.value = data.preset.width;
    state.height.value = data.preset.height;
    state.denoise.value = data.preset.denoise || 1.0;
    state.denoiseVal.textContent = data.preset.denoise || 1.0;
  }

  fillLoras(data.loras || ["none"]);
}

export function populateDefaultsSelects(data) {
  fillSelect(state.defaultsSampler, data.samplers);
  fillSelect(state.defaultsScheduler, data.schedulers);
  // clip/vae used to be edited here; they moved to the Models tab (and these elements went
  // with them), so only fill them if a build still has them.
  if (state.defaultsClipName) fillSelect(state.defaultsClipName, data.clip_models);
  if (state.defaultsClipType) fillSelect(state.defaultsClipType, data.clip_types);
  if (state.defaultsVaeName) fillSelect(state.defaultsVaeName, data.vae_models);
  if (state.chainStage1Sampler) fillSelect(state.chainStage1Sampler, data.samplers);
  if (state.chainStage1Scheduler) fillSelect(state.chainStage1Scheduler, data.schedulers);
  if (state.chainStage2Sampler) fillSelect(state.chainStage2Sampler, data.samplers);
  if (state.chainStage2Scheduler) fillSelect(state.chainStage2Scheduler, data.schedulers);
  // Prompt tab Phase 1/Phase 2 selects
  if (state.chainPromptP1Sampler) fillSelect(state.chainPromptP1Sampler, data.samplers);
  if (state.chainPromptP1Scheduler) fillSelect(state.chainPromptP1Scheduler, data.schedulers);
  if (state.chainPromptP2Sampler) fillSelect(state.chainPromptP2Sampler, data.samplers);
  if (state.chainPromptP2Scheduler) fillSelect(state.chainPromptP2Scheduler, data.schedulers);
}

export function populatePromptSelects(data) {
  if (state.promptSampler) fillSelect(state.promptSampler, data.samplers);
  if (state.promptScheduler) fillSelect(state.promptScheduler, data.schedulers);
}

/**
 * Populate ALL visible Prompt-tab fields from model defaults for the selected mode.
 * This is the single source of truth for Step 2: "user sets generation mode →
 * relevant fields appear pre-filled with per-mode model defaults."
 *
 * @param {string} unet  — current model name
 * @param {string} mode  — "t2i" or "i2i"
 */
export function applyPromptDefaultsForMode(mode) {
  const isChain = mode === "T2I -> I2I" || mode === "T2I -> I2I (Reversed)" || mode === "T2I -> I2I (Ernie->Krea2)" || mode === "T2I -> I2I (Krea2->Ernie)" || mode === "T2I -> I2I (Ernie->Ernie)";

  if (!isChain) {
    // T2I/I2I: fall back to per-model defaults
    const unet = state.unetName.value;
    const modeKey = mode === "I2I" ? "i2i" : "t2i";
    applyPromptDefaultsFromModel(unet, modeKey);
    return;
  }

  // Chain mode: populate from chain Stage 1 defaults AND populate Phase 1 / Phase 2 panels
  // Fetch the correct direction's chain defaults from the server so stage1 always
  // contains Phase 1's model params and stage2 contains Phase 2's model params.
  const reversed = mode === "T2I -> I2I (Reversed)";
  const ernieToKrea2 = mode === "T2I -> I2I (Ernie->Krea2)";
  const krea2ToErnie = mode === "T2I -> I2I (Krea2->Ernie)";
  const ernieUpscale = mode === "T2I -> I2I (Ernie->Ernie)";
  const direction = ernieUpscale ? "ernie_upscale" : (krea2ToErnie ? "krea2_to_ernie" : (ernieToKrea2 ? "ernie_to_krea2" : (reversed ? "reversed" : "forward")));

  fetchDefaults({ action: "load", direction })
    .then(data => {
      if (data.status === "ok" && data.chain) {
        mutableState.chainDefaults = data.chain;
        mutableState.chainDefaultsDirection = direction;
      }
      _populateChainPanels(reversed, mutableState.chainDefaults);
    })
    .catch(() => _populateChainPanels(reversed, null));
}

/**
 * Fill the Phase 1 and Phase 2 panels on the Prompt tab from chain defaults.
 * Falls back to server-side presets (loaded via mutableState.chainDefaults)
 * for any property the user hasn't overridden.
 */
function _populateChainPanels(reversed, cd) {
  const ernieToKrea2 = mutableState.chainDefaultsDirection === "ernie_to_krea2";
  const krea2ToErnie = mutableState.chainDefaultsDirection === "krea2_to_ernie";
  const ernieUpscale = mutableState.chainDefaultsDirection === "ernie_upscale";
  const stage1 = (cd?.stage1) || {};
  const stage2 = (cd?.stage2) || {};

  // Determine default models and LoRAs based on direction
  let p1DefaultModel, p2DefaultModel, p1DefaultLora1, p1DefaultLora2, p2DefaultLora1, p2DefaultLora2;
  if (ernieUpscale) {
    p1DefaultModel = "ernie-image-turbo.safetensors";
    p2DefaultModel = "ernie-image-turbo.safetensors";
    p1DefaultLora1 = "ernie/ernie-anime-v1.safetensors";
    p1DefaultLora2 = "none";
    p2DefaultLora1 = "ernie/ernie-anime-v1.safetensors";
    p2DefaultLora2 = "none";
  } else if (krea2ToErnie) {
    p1DefaultModel = "krea2_turbo_fp8_scaled.safetensors";
    p2DefaultModel = "ernie-image-turbo.safetensors";
    p1DefaultLora1 = "none";
    p1DefaultLora2 = "none";
    p2DefaultLora1 = "ernie/ernie-anime-v1.safetensors";
    p2DefaultLora2 = "none";
  } else if (ernieToKrea2) {
    p1DefaultModel = "ernie-image-turbo.safetensors";
    p2DefaultModel = "krea2_turbo_fp8_scaled.safetensors";
    p1DefaultLora1 = "ernie/ernie-anime-v1.safetensors";
    p1DefaultLora2 = "none";
    p2DefaultLora1 = "none";
    p2DefaultLora2 = "none";
  } else if (reversed) {
    p1DefaultModel = "ernie-image-turbo.safetensors";
    p2DefaultModel = "z_image_turbo_bf16.safetensors";
    p1DefaultLora1 = "ernie/ernie-anime-v1.safetensors";
    p1DefaultLora2 = "none";
    p2DefaultLora1 = "zturbo/char/K@te_20260211104109.safetensors";
    p2DefaultLora2 = "zturbo/style/JabZ - ZIT .safetensors";
  } else {
    p1DefaultModel = "z_image_turbo_bf16.safetensors";
    p2DefaultModel = "ernie-image-turbo.safetensors";
    p1DefaultLora1 = "zturbo/char/K@te_20260211104109.safetensors";
    p1DefaultLora2 = "zturbo/style/JabZ - ZIT .safetensors";
    p2DefaultLora1 = "ernie/ernie-anime-v1.safetensors";
    p2DefaultLora2 = "none";
  }

  // Fill Phase 1 panel
  if (state.chainPromptP1Model) state.chainPromptP1Model.value = stage1.unet_name || p1DefaultModel;
  if (state.chainPromptP1Sampler) state.chainPromptP1Sampler.value = stage1.sampler || "euler";
  if (state.chainPromptP1Scheduler) state.chainPromptP1Scheduler.value = stage1.scheduler || "simple";
  if (state.chainPromptP1Steps) { state.chainPromptP1Steps.value = stage1.steps || 8; state.chainPromptP1StepsVal.textContent = state.chainPromptP1Steps.value; }
  if (state.chainPromptP1CFG) { state.chainPromptP1CFG.value = stage1.cfg !== undefined ? stage1.cfg : 1.0; state.chainPromptP1CFGVal.textContent = state.chainPromptP1CFG.value; }
  if (state.chainPromptP1Denoise) { state.chainPromptP1Denoise.value = stage1.denoise !== undefined ? stage1.denoise : 1.0; state.chainPromptP1DenoiseVal.textContent = state.chainPromptP1Denoise.value; }
  if (state.chainPromptP1MP) state.chainPromptP1MP.value = stage1.mp !== undefined ? stage1.mp : DEFAULT_MP;
  if (state.chainPromptP1AR) state.chainPromptP1AR.value = stage1.ar || "9:16";

  const p1Loras = (ernieUpscale
    ? mutableState.modelUserSettings["ernie-image-turbo.safetensors"]
    : (krea2ToErnie
    ? mutableState.modelUserSettings["krea2_turbo_fp8_scaled.safetensors"]
    : (ernieToKrea2
    ? mutableState.modelUserSettings["ernie-image-turbo.safetensors"]
    : (reversed ? mutableState.modelUserSettings["ernie-image-turbo.safetensors"] : mutableState.modelUserSettings["z_image_turbo_bf16.safetensors"]))))?.loras || ["none"];
  if (state.chainPromptP1Lora1Name) fillSelect(state.chainPromptP1Lora1Name, p1Loras);
  if (state.chainPromptP1Lora2Name) fillSelect(state.chainPromptP1Lora2Name, p1Loras);
  if (state.chainPromptP1Lora1Name) state.chainPromptP1Lora1Name.value = (stage1.lora1_name !== undefined && p1Loras.includes(stage1.lora1_name)) ? stage1.lora1_name : p1DefaultLora1;
  if (state.chainPromptP1Lora1Strength) { state.chainPromptP1Lora1Strength.value = stage1.lora1_strength !== undefined ? stage1.lora1_strength : (ernieUpscale ? 0.35 : (krea2ToErnie ? 0.0 : (ernieToKrea2 ? 0.35 : (reversed ? 0.35 : 0.6)))); state.chainPromptP1Lora1StrengthVal.textContent = state.chainPromptP1Lora1Strength.value; }
  if (state.chainPromptP1Lora2Name) state.chainPromptP1Lora2Name.value = (stage1.lora2_name !== undefined && p1Loras.includes(stage1.lora2_name)) ? stage1.lora2_name : p1DefaultLora2;
  if (state.chainPromptP1Lora2Strength) { state.chainPromptP1Lora2Strength.value = stage1.lora2_strength !== undefined ? stage1.lora2_strength : (krea2ToErnie ? 0.0 : (ernieToKrea2 ? 0.0 : (reversed ? 0.0 : 0.35))); state.chainPromptP1Lora2StrengthVal.textContent = state.chainPromptP1Lora2Strength.value; }

  // Fill Phase 2 panel
  if (state.chainPromptP2Model) state.chainPromptP2Model.value = stage2.unet_name || p2DefaultModel;
  if (state.chainPromptP2Sampler) state.chainPromptP2Sampler.value = stage2.sampler || "euler";
  if (state.chainPromptP2Scheduler) state.chainPromptP2Scheduler.value = stage2.scheduler || "simple";
  if (state.chainPromptP2Steps) { state.chainPromptP2Steps.value = stage2.steps || 8; state.chainPromptP2StepsVal.textContent = state.chainPromptP2Steps.value; }
  if (state.chainPromptP2CFG) { state.chainPromptP2CFG.value = stage2.cfg !== undefined ? stage2.cfg : 1.0; state.chainPromptP2CFGVal.textContent = state.chainPromptP2CFG.value; }
  if (state.chainPromptP2Denoise) { state.chainPromptP2Denoise.value = stage2.denoise !== undefined ? stage2.denoise : 0.5; state.chainPromptP2DenoiseVal.textContent = state.chainPromptP2Denoise.value; }
  const p1MP = parseFloat(state.chainPromptP1MP?.value) || stage1.mp || 1.54;
  const p2Upscale = stage2.upscale !== undefined ? stage2.upscale : 1.0;
  if (state.chainPromptP2TargetMP) state.chainPromptP2TargetMP.value = (p1MP * p2Upscale * p2Upscale).toFixed(2);

  const p2Loras = (ernieUpscale
    ? mutableState.modelUserSettings["ernie-image-turbo.safetensors"]
    : (krea2ToErnie
    ? mutableState.modelUserSettings["ernie-image-turbo.safetensors"]
    : (ernieToKrea2
    ? mutableState.modelUserSettings["krea2_turbo_fp8_scaled.safetensors"]
    : (reversed ? mutableState.modelUserSettings["z_image_turbo_bf16.safetensors"] : mutableState.modelUserSettings["ernie-image-turbo.safetensors"]))))?.loras || ["none"];
  if (state.chainPromptP2Lora1Name) fillSelect(state.chainPromptP2Lora1Name, p2Loras);
  if (state.chainPromptP2Lora2Name) fillSelect(state.chainPromptP2Lora2Name, p2Loras);
  if (state.chainPromptP2Lora1Name) state.chainPromptP2Lora1Name.value = (stage2.lora1_name !== undefined && p2Loras.includes(stage2.lora1_name)) ? stage2.lora1_name : p2DefaultLora1;
  if (state.chainPromptP2Lora1Strength) { state.chainPromptP2Lora1Strength.value = stage2.lora1_strength !== undefined ? stage2.lora1_strength : (ernieUpscale ? 0.35 : (krea2ToErnie ? 0.35 : (ernieToKrea2 ? 0.0 : (reversed ? 0.6 : 0.35)))); state.chainPromptP2Lora1StrengthVal.textContent = state.chainPromptP2Lora1Strength.value; }
  if (state.chainPromptP2Lora2Name) state.chainPromptP2Lora2Name.value = (stage2.lora2_name !== undefined && p2Loras.includes(stage2.lora2_name)) ? stage2.lora2_name : p2DefaultLora2;
  if (state.chainPromptP2Lora2Strength) { state.chainPromptP2Lora2Strength.value = stage2.lora2_strength !== undefined ? stage2.lora2_strength : (krea2ToErnie ? 0.0 : (ernieToKrea2 ? 0.0 : (reversed ? 0.35 : 0.0))); state.chainPromptP2Lora2StrengthVal.textContent = state.chainPromptP2Lora2Strength.value; }

  // Update title with Phase 1 model
  updateTitle(stage1.unet_name || p1DefaultModel);
}

export function applyPromptDefaultsFromModel(unet, mode) {
  const data = mutableState.modelUserSettings[unet];
  if (!data) return; // will be called again after fetch

  const preset = data.preset || {};
  const user = data.user_settings || {};
  // Defaults saved in Defaults tab (per-model, per-mode)
  const saved = mutableState.config?.defaults?.[unet]?.[mode] || {};

  function pick(field, fallback) {
    if (user[field] !== undefined && user[field] !== null) return user[field];
    if (saved[field] !== undefined && saved[field] !== null) return saved[field];
    if (preset[field] !== undefined && preset[field] !== null) return preset[field];
    return fallback;
  }

  // Sampler + Scheduler
  if (state.promptSampler) state.promptSampler.value = pick("sampler", "euler");
  if (state.promptScheduler) state.promptScheduler.value = pick("scheduler", "simple");

  // Steps, CFG, Denoise
  if (state.promptSteps) { state.promptSteps.value = pick("steps", 8); state.promptStepsVal.textContent = state.promptSteps.value; }
  if (state.promptCFG) { state.promptCFG.value = pick("cfg", 1.0); state.promptCFGVal.textContent = state.promptCFG.value; }
  if (state.promptPAG) { state.promptPAG.value = pick("pag_scale", 0.0); state.promptPAGVal.textContent = state.promptPAG.value; }
  state.denoise.value = pick("denoise", mode === "i2i" ? 0.8 : 1.0);
  state.denoiseVal.textContent = state.denoise.value;

  // Dimensions: use defaults tab if available, else preset
  const mp = pick("mp", isQwen21(unet) ? QWEN21_NATIVE_MP : DEFAULT_MP);
  const ar = pick("ar", "9:16");
  state.mpInput.value = mp;
  state.arInput.value = ar;

  // LoRAs
  const loras = data.loras || ["none"];
  const lora1 = pick("lora1_name", "none");
  if (loras.includes(lora1) || lora1 === "none") state.lora1Name.value = lora1;
  else state.lora1Name.value = preset.lora1_name !== undefined ? preset.lora1_name : "none";
  state.lora1Strength.value = pick("lora1_strength", 0.35);
  state.lora1StrengthVal.textContent = state.lora1Strength.value;

  const lora2 = pick("lora2_name", "none");
  if (loras.includes(lora2) || lora2 === "none") state.lora2Name.value = lora2;
  else state.lora2Name.value = preset.lora2_name !== undefined ? preset.lora2_name : "none";
  state.lora2Strength.value = pick("lora2_strength", 0.0);
  state.lora2StrengthVal.textContent = state.lora2Strength.value;

  // Recalc dimensions display
  if (mode === "i2i" && mutableState.detectedImageAR) {
    updateI2IDimensions();
  } else if (mode === "t2i") {
    recalcDimensions();
  }
}

/** Update which fields are visible in the Prompt-tab based on Mode. */
export function updatePromptFieldVisibility() {
  const mode = state.generationMode.value;
  const isT2I = mode === "T2I";
  const isI2I = mode === "I2I";
  const isChain = mode === "T2I -> I2I" || mode === "T2I -> I2I (Reversed)" || mode === "T2I -> I2I (Ernie->Krea2)" || mode === "T2I -> I2I (Krea2->Ernie)" || mode === "T2I -> I2I (Ernie->Ernie)";

  // Helper: show/hide with null guard
  const setDisplay = (el, show) => { if (el) el.style.display = show ? "" : "none"; };

  // Toggle single vs chain controls
  if (state.promptSingleControls) state.promptSingleControls.style.display = isChain ? "none" : "block";
  if (state.promptChainControls) {
    state.promptChainControls.style.display = isChain ? "" : "none";
    if (isChain) state.promptChainControls.classList.remove("hidden");
    else state.promptChainControls.classList.add("hidden");
  }

  // Model selector — hidden in chains because model is fixed by direction
  setDisplay(state.modelSelectWrap, !isChain);

  // Input Image — I2I only
  setDisplay(state.inputImageWrap, isI2I);

  // MP + AR row + Computed Dims — single modes only (Phase 1 panel has its own in chain mode)
  if (isT2I) {
    state.mpArRow.style.display = "flex";
    state.calcDisplayWrap.style.display = "block";
    if (state.mpLabel) { state.mpLabel.textContent = "Megapixels"; state.mpLabel.title = ""; }
    if (state.arLabel) { state.arLabel.textContent = "Aspect Ratio"; state.arLabel.title = ""; }
    state.arInput.readOnly = false;
  } else if (isI2I) {
    if (mutableState.detectedImageAR) {
      state.mpArRow.style.display = "flex";
      state.calcDisplayWrap.style.display = "block";
      if (state.mpLabel) { state.mpLabel.textContent = "Target Megapixels"; state.mpLabel.title = "Resize input image to this megapixels before diffusion"; }
      if (state.arLabel) state.arLabel.textContent = "Detected Aspect Ratio";
      state.arInput.value = formatAR(mutableState.detectedImageAR);
      state.arInput.readOnly = true;
    } else {
      state.mpArRow.style.display = "none";
      state.calcDisplayWrap.style.display = "none";
    }
  } else {
    // Chain mode — hide shared row (Phase 1 panel has its own)
    state.mpArRow.style.display = "none";
    state.calcDisplayWrap.style.display = "none";
  }

  // Sampling — visible in single modes (hidden in chain, shown in Phase panels instead)
  setDisplay(state.promptSamplingRow, !isChain);

  // Steps + CFG + Denoise — visible in single modes
  setDisplay(state.promptParamsRow, !isChain);

  // Seed — visible in single modes
  setDisplay(state.promptSeedWrap, !isChain);

  // LoRA rows — visible in single modes
  setDisplay(state.promptLora1Row, !isChain);
  setDisplay(state.promptLora2Row, !isChain);
}

export function applyPreset(unet) {
  const mode = state.generationMode.value === "I2I" ? "i2i" : "t2i";
  // Returns the promise: the fields below land after a round-trip, and callers that read them
  // (the reference strip, the PhotoCraft checkbox wording, the template button) must wait for it —
  // a plain call left them judging the outgoing model's clip type.
  return fetchModels(unet, mode)
    .then(data => {
      if (data.status !== "ok") return;
      mutableState.modelUserSettings[unet] = data;
      fillLoras(data.loras);
      if (data.preset) {
        const p = data.preset;
        if (p.clip_name) state.clipName.value = p.clip_name;
        if (p.clip_type) state.clipType.value = p.clip_type;
        if (p.vae_name) state.vaeName.value = p.vae_name;
        // Assigned programmatically, so no change event fires on its own; anything watching the
        // encoder family would otherwise miss the swap.
        if (p.clip_type && state.clipType) {
          state.clipType.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (p.steps !== undefined) { state.steps.value = p.steps; state.stepsVal.textContent = p.steps; }
        if (p.cfg !== undefined) { state.cfg.value = p.cfg; state.cfgVal.textContent = p.cfg; }
        if (p.sampler) state.sampler.value = p.sampler;
        const isI2IWithImage = state.generationMode.value === "I2I" && mutableState.detectedImageAR;
        if (!isI2IWithImage) {
          if (p.width !== undefined) state.width.value = p.width;
          if (p.height !== undefined) state.height.value = p.height;
        }
        if (p.denoise !== undefined) { state.denoise.value = p.denoise; state.denoiseVal.textContent = p.denoise; }

        const user = data.user_settings || {};
        if (user.lora1_name !== undefined && data.loras.includes(user.lora1_name)) {
          state.lora1Name.value = user.lora1_name;
        } else if (p.lora1_name !== undefined) {
          state.lora1Name.value = p.lora1_name;
        }
        if (user.lora1_strength !== undefined) {
          state.lora1Strength.value = user.lora1_strength;
          state.lora1StrengthVal.textContent = user.lora1_strength;
        } else if (p.lora1_strength !== undefined) {
          state.lora1Strength.value = p.lora1_strength;
          state.lora1StrengthVal.textContent = p.lora1_strength;
        }
        if (user.lora2_name !== undefined && data.loras.includes(user.lora2_name)) {
          state.lora2Name.value = user.lora2_name;
        } else if (p.lora2_name !== undefined) {
          state.lora2Name.value = p.lora2_name;
        }
        if (user.lora2_strength !== undefined) {
          state.lora2Strength.value = user.lora2_strength;
          state.lora2StrengthVal.textContent = user.lora2_strength;
        } else if (p.lora2_strength !== undefined) {
          state.lora2Strength.value = p.lora2_strength;
          state.lora2StrengthVal.textContent = p.lora2_strength;
        }
      }
      if (state.generationMode.value === "I2I" && mutableState.detectedImageAR) {
        updateI2IDimensions();
      }
      updateTitle(unet);
      // Applied programmatically = no input/change events, so anyone showing a summary of the
      // fields (the folded Generation Setup header) has to be told explicitly.
      try { window.dispatchEvent(new CustomEvent("preset-applied", { detail: { unet } })); } catch (e) {}
    });
}

export function saveUserSettings() {
  const mode = state.generationMode.value === "I2I" ? "i2i" : "t2i";
  saveSettings({
    unet_name: state.unetName.value,
    generation_mode: mode,
    lora1_name: state.lora1Name.value,
    lora1_strength: parseFloat(state.lora1Strength.value),
    lora2_name: state.lora2Name.value,
    lora2_strength: parseFloat(state.lora2Strength.value),
  }).catch(() => {});
}

// ── Settings auto-save ───────────────────────────────────────────
// Everything the user tunes must survive a reload, so the Prompt tab writes
// back per model+mode automatically — waiting for an explicit "Save" is what
// made a hard refresh look like it had thrown the settings away. Only the
// generation params are sent; the server merges them over the stored entry so
// the Defaults tab's clip/vae keys are left intact.
//
// Debounced because several of these are sliders that fire on every pixel of
// drag; the write is a small local JSON file, but one request per input event
// would still be absurd.
const AUTOSAVE_DEBOUNCE_MS = 600;
let autosaveTimer = null;
let autosaveEnabled = false;
let autosaveSuspended = false;

function collectGenerationSettings() {
  const mode = state.generationMode.value === "I2I" ? "i2i" : "t2i";
  const payload = {
    unet_name: state.unetName.value,
    mode,
    defaults: {
      sampler: state.promptSampler ? state.promptSampler.value : undefined,
      scheduler: state.promptScheduler ? state.promptScheduler.value : undefined,
      steps: state.promptSteps ? parseInt(state.promptSteps.value, 10) : undefined,
      cfg: state.promptCFG ? parseFloat(state.promptCFG.value) : undefined,
      denoise: parseFloat(state.denoise.value),
      mp: parseFloat(state.mpInput.value),
      ar: state.arInput.value,
      lora1_name: state.lora1Name.value || "none",
      lora1_strength: parseFloat(state.lora1Strength.value),
      lora2_name: state.lora2Name.value || "none",
      lora2_strength: parseFloat(state.lora2Strength.value),
    },
  };
  if (state.promptPAG) payload.defaults.pag_scale = parseFloat(state.promptPAG.value);
  // Drop undefined so a control that does not exist for this mode cannot
  // overwrite a stored value with null.
  payload.defaults = Object.fromEntries(
    Object.entries(payload.defaults).filter(([, v]) => v !== undefined && !Number.isNaN(v))
  );
  return payload;
}

export function scheduleSettingsAutosave() {
  if (!autosaveEnabled || autosaveSuspended) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    fetchDefaults({ action: "save", ...collectGenerationSettings() }).catch(() => {});
  }, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Hold off auto-save while the app is repainting the fields.
 *
 * Switching model is the case that matters: the change handler fetches the new
 * model's saved settings asynchronously, and without this the debounced write
 * would fire first and store the *previous* model's values under the new
 * model's name. Any pending write is cancelled on suspend, so the repaint is
 * what ends up persisted (or rather, not persisted — the values were just read
 * from disk).
 */
export function setAutosaveSuspended(suspended) {
  autosaveSuspended = !!suspended;
  if (autosaveSuspended && autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

/** Remember the selected model so a reload comes back to it, not to model #1. */
export function saveLastModel(unet) {
  if (!unet) return;
  fetch("/api/ui_state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ last_unet: unet }),
  }).catch(() => {});
}

/**
 * Wire auto-save onto every generation control.
 *
 * Called only after the startup sequence has finished painting the fields with
 * the model's stored/preset values — attaching earlier would capture the bare
 * HTML defaults and immediately persist them over the user's real settings.
 */
export function initSettingsAutosave() {
  const watched = [
    state.promptSampler, state.promptScheduler, state.promptSteps, state.promptCFG,
    state.promptPAG, state.denoise, state.mpInput, state.arInput,
    state.lora1Name, state.lora1Strength, state.lora2Name, state.lora2Strength,
    state.unetName, state.generationMode,
  ];
  watched.forEach(el => {
    if (!el) return;
    el.addEventListener("change", scheduleSettingsAutosave);
    el.addEventListener("input", scheduleSettingsAutosave);
  });
  autosaveEnabled = true;
}



export function updateInputImageVisibility() {
  const isI2I = state.generationMode.value === "I2I";
  state.inputImageWrap.style.display = isI2I ? "block" : "none";
  if (isI2I) {
    if (!mutableState._savedT2IDims) {
      mutableState._savedT2IDims = { width: state.width.value, height: state.height.value, ar: state.arInput.value, mode: state.dimensionMode.value };
    }
  } else {
    if (mutableState._savedT2IDims) {
      state.width.value = mutableState._savedT2IDims.width;
      state.height.value = mutableState._savedT2IDims.height;
      state.arInput.value = mutableState._savedT2IDims.ar;
      mutableState._savedT2IDims = null;
    }
  }
  const dimModeField = state.dimensionMode.closest(".field");
  if (dimModeField) dimModeField.style.display = isI2I ? "none" : "";
}

export function resetPromptTabToDefaults() {
  const mode = state.generationMode.value;
  const isChain = mode === "T2I -> I2I" || mode === "T2I -> I2I (Reversed)" || mode === "T2I -> I2I (Ernie->Krea2)" || mode === "T2I -> I2I (Krea2->Ernie)" || mode === "T2I -> I2I (Ernie->Ernie)";

  if (isChain) {
    const reversed = mode === "T2I -> I2I (Reversed)";
    const ernieToKrea2 = mode === "T2I -> I2I (Ernie->Krea2)";
    const krea2ToErnie = mode === "T2I -> I2I (Krea2->Ernie)";
    const ernieUpscale = mode === "T2I -> I2I (Ernie->Ernie)";
    const direction = ernieUpscale ? "ernie_upscale" : (krea2ToErnie ? "krea2_to_ernie" : (ernieToKrea2 ? "ernie_to_krea2" : (reversed ? "reversed" : "forward")));
    return fetchDefaults({ action: "load", direction })
      .then(data => {
        if (data.status !== "ok" || !data.chain) {
          showToast("Could not load chain defaults", "error");
          return;
        }
        mutableState.chainDefaults = data.chain;
        mutableState.chainDefaultsDirection = direction;
        applyPromptDefaultsForMode(mode);
        showToast("Reset to chain defaults", "success");
      })
      .catch(() => showToast("Failed to reset chain defaults", "error"));
  }

  const unet = state.unetName.value;
  const modeKey = mode === "I2I" ? "i2i" : "t2i";
  return fetchDefaults({ action: "load", unet_name: unet, mode: modeKey })
    .then(data => {
      if (data.status !== "ok" || !data.defaults) {
        showToast("Could not load defaults", "error");
        return;
      }
      const d = data.defaults;
      const lorasList = (data.loras && data.loras.length > 0) ? data.loras : ["none"];

      // Cache for future applies
      if (!mutableState.config) mutableState.config = {};
      if (!mutableState.config.defaults) mutableState.config.defaults = {};
      if (!mutableState.config.defaults[unet]) mutableState.config.defaults[unet] = {};
      mutableState.config.defaults[unet][modeKey] = d;

      // Apply to visible prompt-tab fields
      if (state.promptSampler) state.promptSampler.value = d.sampler || "euler";
      if (state.promptScheduler) state.promptScheduler.value = d.scheduler || "simple";
      if (state.promptSteps) { state.promptSteps.value = d.steps || 8; state.promptStepsVal.textContent = d.steps || 8; }
      if (state.promptCFG) { state.promptCFG.value = d.cfg || 1.0; state.promptCFGVal.textContent = d.cfg || 1.0; }
      if (state.promptPAG) { state.promptPAG.value = d.pag_scale || 0.0; state.promptPAGVal.textContent = state.promptPAG.value; }
      state.denoise.value = d.denoise || (modeKey === "i2i" ? 0.8 : 1.0);
      state.denoiseVal.textContent = state.denoise.value;
      state.mpInput.value = d.mp || 1.54;
      state.arInput.value = d.ar || "9:16";

      fillSelect(state.lora1Name, lorasList);
      fillSelect(state.lora2Name, lorasList);
      const lora1 = (d.lora1_name !== undefined && lorasList.includes(d.lora1_name)) ? d.lora1_name : "none";
      state.lora1Name.value = lora1;
      state.lora1Strength.value = d.lora1_strength || 0.0;
      state.lora1StrengthVal.textContent = d.lora1_strength || 0.0;
      const lora2 = (d.lora2_name !== undefined && lorasList.includes(d.lora2_name)) ? d.lora2_name : "none";
      state.lora2Name.value = lora2;
      state.lora2Strength.value = d.lora2_strength || 0.0;
      state.lora2StrengthVal.textContent = d.lora2_strength || 0.0;

      // Update dimension display
      if (modeKey === "i2i" && mutableState.detectedImageAR) {
        updateI2IDimensions();
      } else if (modeKey === "t2i") {
        recalcDimensions();
      }

      showToast(`Reset to ${mode} defaults`, "success");
    })
    .catch(() => showToast("Failed to reset defaults", "error"));
}



export function switchTab(tab) {
  state.tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  state.tabPanels.forEach(p => p.classList.toggle("active", p.id === tab + "Panel"));
}

export function moveCursorGlow(x, y) {
  state.cursorGlow.style.left = x + "px";
  state.cursorGlow.style.top = y + "px";
  state.cursorGlow.style.opacity = "1";
}

export function hideCursorGlow() {
  state.cursorGlow.style.opacity = "0";
}
