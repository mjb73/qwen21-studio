/* models.js — the Models tab: which ComfyUI folder to read, and what each model is made of.
 *
 * A diffusion model file generates nothing on its own: it needs the text encoder it was trained
 * against and that family's VAE. Until this tab existed those pairings were hardcoded to the file
 * names on one machine, which is the single thing that stopped the app running anywhere else.
 * /api/registry returns the folder, the files actually on disk, and the saved pairings; Save posts
 * them back and the server writes config.json (plus the presets/lists the rest of the app reads).
 */

import * as state from "./state-v2.js?v=x54";
import { mutableState } from "./state-v2.js?v=x54";
import { fetchRegistry, saveRegistry, detectComfy, fetchConfig } from "./api.js?v=x54";
import { showToast, fillSelect, fillModelSelect } from "./ui.js?v=x54";

let reg = null;          // last /api/registry payload
let dirty = false;       // unsaved edits exist

const el = (id) => document.getElementById(id);

// ── Family hints: which encoder / VAE a model name usually goes with ─────────────
// Only a starting point for the Guess button — every field stays editable, and a wrong guess
// costs one dropdown change instead of a failed render.
const FAMILY_HINTS = [
  { test: /qwen_?image_?2\.1|qwenimage21/i, type: "qwen_image", encoder: /qwen3vl/i, vae: /qwen_image_2\.1|qwen_image/i },
  { test: /krea/i, type: "krea2", encoder: /qwen3vl_?4b/i, vae: /qwen_image_vae/i },
  { test: /z_?anime|z_?image/i, type: "lumina2", encoder: /qwen_?3_?4b/i, vae: /turbo_z_ae|z_?ae/i },
  { test: /ernie|jibmix/i, type: "flux2", encoder: /ministral|flux2|gemma/i, vae: /flux2/i },
  { test: /moss/i, type: "moss_image", encoder: /qwen3\.?5|qwen3vl/i, vae: /flux2_vae_small|moss/i },
];

function hintFor(unetName) {
  const name = unetName || "";
  return FAMILY_HINTS.find(h => h.test.test(name)) || null;
}

function guessEncoderType(unetName) {
  const hint = hintFor(unetName);
  return hint ? hint.type : "";
}

function bestMatch(files, pattern) {
  if (!files || !files.length) return "";
  const hit = files.find(f => pattern.test(f.name));
  return hit ? hit.name : "";
}

// ── Rendering ───────────────────────────────────────────────────────────────────
function optionList(select, names, current, emptyLabel) {
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = emptyLabel;
  select.appendChild(blank);
  names.forEach(n => {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n;
    select.appendChild(opt);
  });
  select.value = names.includes(current) ? current : "";
  if (current && !names.includes(current)) {
    // The file is named but not on disk: keep it visible instead of silently resetting the field
    const opt = document.createElement("option");
    opt.value = current;
    opt.textContent = current + "  (not in folder)";
    select.appendChild(opt);
    select.value = current;
  }
}

function filesOf(kind) {
  return (reg && reg.scanned && reg.scanned[kind]) || [];
}

function namesOf(kind) {
  return filesOf(kind).map(f => f.name);
}

function renderFolders() {
  if (!reg) return;
  el("modelsComfyRoot").value = reg.paths.comfy_root || "";
  el("modelsComfyPython").value = reg.paths.comfy_python || "";
  el("modelsOutputDir").value = reg.paths.output_dir || "";
  el("modelsLorasRoot").value = reg.paths.loras_root || "";
  el("modelsComfyHost").value = reg.paths.comfy_host || "";
  const counts = Object.entries(reg.scanned || {})
    .map(([kind, files]) => `${files.length} ${kind.replace("_", " ")}${files.length === 1 ? "" : "s"}`)
    .join("  ·  ");
  const dirs = (reg.dirs_resolved && reg.dirs_resolved.unet) || [];
  el("modelsFolderStatus").innerHTML =
    `<span class="${reg.comfy_running ? "ok" : "warn"}">${reg.comfy_running ? "ComfyUI answering" : "ComfyUI not answering"}</span>` +
    ` — found ${counts || "nothing"}` +
    `<br><span class="dim">${dirs.length ? dirs.join("   ") : "no model folders"}</span>`;
}

function renderCard(entry, index) {
  const card = document.createElement("div");
  card.className = "model-card";
  card.dataset.idx = String(index);

  const head = document.createElement("div");
  head.className = "model-card-head";
  head.innerHTML = `
    <input class="model-name" type="text" placeholder="Name shown in the app" value="${(entry.name || "").replace(/"/g, "&quot;")}">
    <span class="model-flag ${entry.exists ? "hidden" : ""}">file missing</span>
    <button class="model-del" title="Remove this model">&times;</button>`;
  card.appendChild(head);

  const field = (label, node) => {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lab = document.createElement("label");
    lab.textContent = label;
    wrap.append(lab, node);
    return wrap;
  };

  const unet = document.createElement("select");
  unet.className = "model-unet";
  optionList(unet, namesOf("unet"), entry.unet || "", "— choose a model file —");
  card.appendChild(field("Model file (diffusion model)", unet));

  const encoder = document.createElement("select");
  encoder.className = "model-encoder";
  optionList(encoder, namesOf("text_encoder"), entry.text_encoder || "", "— choose a text encoder —");
  card.appendChild(field("Text encoder", encoder));

  const encType = document.createElement("select");
  encType.className = "model-enc-type";
  optionList(encType, (reg && reg.encoder_types) || [], entry.encoder_type || "", "— encoder type —");
  card.appendChild(field("Encoder type (CLIP type)", encType));

  const vae = document.createElement("select");
  vae.className = "model-vae";
  optionList(vae, namesOf("vae"), entry.vae || "", "— choose a VAE —");
  card.appendChild(field("VAE", vae));

  const row = document.createElement("div");
  row.className = "form-row three";
  const num = (cls, label, value, min, max, step) => {
    const input = document.createElement("input");
    input.type = "number";
    input.className = cls;
    input.value = value === undefined || value === null ? "" : value;
    input.min = min; input.max = max; input.step = step;
    return field(label, input);
  };
  row.append(
    num("model-steps", "Steps", entry.steps, 1, 100, 1),
    num("model-cfg", "CFG", entry.cfg, 0, 20, 0.1),
  );
  const samplerWrap = document.createElement("div");
  samplerWrap.className = "field";
  const sampler = document.createElement("select");
  sampler.className = "model-sampler";
  optionList(sampler, (reg && reg.samplers) || [], entry.sampler || "euler", "— sampler —");
  const slabel = document.createElement("label");
  slabel.textContent = "Sampler";
  samplerWrap.append(slabel, sampler);
  row.appendChild(samplerWrap);
  card.appendChild(row);

  const row2 = document.createElement("div");
  row2.className = "form-row two";
  const schedWrap = document.createElement("div");
  schedWrap.className = "field";
  const sched = document.createElement("select");
  sched.className = "model-scheduler";
  optionList(sched, (reg && reg.schedulers) || [], entry.scheduler || "simple", "— scheduler —");
  const slabel2 = document.createElement("label");
  slabel2.textContent = "Scheduler";
  schedWrap.append(slabel2, sched);
  row2.appendChild(schedWrap);
  const guessWrap = document.createElement("div");
  guessWrap.className = "field";
  const guess = document.createElement("button");
  guess.className = "btn secondary model-guess";
  guess.textContent = "Guess encoder + VAE";
  guessWrap.appendChild(guess);
  row2.appendChild(guessWrap);
  card.appendChild(row2);

  // ── behaviour ──
  card.addEventListener("input", () => { dirty = true; });
  card.addEventListener("change", () => { dirty = true; });

  guess.addEventListener("click", () => {
    const name = unet.value;
    const hint = hintFor(name);
    if (hint) {
      encType.value = hint.type;
      const enc = bestMatch(filesOf("text_encoder"), hint.encoder);
      const v = bestMatch(filesOf("vae"), hint.vae);
      if (enc) encoder.value = enc;
      if (v) vae.value = v;
      showToast(hint.type ? `Guessed ${hint.type}` : "No known family for that file", "success");
    } else {
      showToast("No known family for that file — pick the encoder and VAE yourself", "error");
    }
    dirty = true;
  });

  // No confirm() dialog: removing a card only edits the list in front of you — nothing is written
  // until Save models, so a mistake costs a reload. A modal here also blocks a panel that hosts
  // this app in an iframe.
  card.querySelector(".model-del").addEventListener("click", () => {
    const idx = Number(card.dataset.idx);
    collect();                     // keep the other cards' edits
    mutableState.registryModels.splice(idx, 1);
    renderList();
    dirty = true;
  });

  return card;
}

function renderList() {
  const list = el("modelsList");
  list.innerHTML = "";
  const models = mutableState.registryModels || [];
  if (!models.length) {
    const empty = document.createElement("div");
    empty.className = "models-hint";
    empty.textContent = "No models yet. Set the ComfyUI folder above, press Scan folder, then Add model "
      + "and pair the model file with its text encoder and VAE.";
    list.appendChild(empty);
    return;
  }
  models.forEach((entry, i) => list.appendChild(renderCard(entry, i)));
}

// ── Reading the cards back ──────────────────────────────────────────────────────
function collect() {
  const list = el("modelsList");
  const out = [];
  list.querySelectorAll(".model-card").forEach(card => {
    const val = (sel) => (card.querySelector(sel) || {}).value || "";
    const unet = val(".model-unet");
    if (!unet) return;                       // a card with no file chosen is not a model yet
    out.push({
      name: val(".model-name").trim() || unet.replace(/\.(safetensors|gguf)$/i, ""),
      unet,
      loader: /\.gguf$/i.test(unet) ? "UnetLoaderGGUF" : "UNETLoader",
      text_encoder: val(".model-encoder"),
      encoder_type: val(".model-enc-type"),
      vae: val(".model-vae"),
      steps: val(".model-steps") === "" ? undefined : Number(val(".model-steps")),
      cfg: val(".model-cfg") === "" ? undefined : Number(val(".model-cfg")),
      sampler: val(".model-sampler") || undefined,
      scheduler: val(".model-scheduler") || undefined,
    });
  });
  mutableState.registryModels = out;
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────────────
export function isDirty() {
  return dirty;
}

export function loadModelsTab(force) {
  if (reg && !force && !dirty) {
    renderFolders();
    renderList();
    return;
  }
  el("modelsFolderStatus").textContent = "Scanning…";
  fetchRegistry().then(data => {
    if (data.status !== "ok") {
      el("modelsFolderStatus").textContent = data.message || "Could not read the registry";
      return;
    }
    reg = data;
    mutableState.registryModels = (data.models || []).map(m => ({ ...m }));
    renderFolders();
    renderList();
    dirty = false;
  });
}

function refreshAppFromRegistry(data) {
  // The saved registry is what the rest of the app selects from, so rebuild both the Prompt tab's
  // model list and the Defaults sub-tabs from the payload the server just returned.
  const info = (data.models || []).map(m => ({
    name: m.unet,
    kind: /\.gguf$/i.test(m.unet) ? "gguf" : "safetensors",
    size_gb: null,
  }));
  const names = info.map(i => i.name);
  if (state.unetName) {
    const previous = state.unetName.value;
    fillModelSelect(state.unetName, info, names);
    if (names.includes(previous)) state.unetName.value = previous;
  }
  rebuildDefaultsTabs(data.models || []);
  try { window.dispatchEvent(new CustomEvent("registry-saved", { detail: { models: data.models || [] } })); } catch (e) {}
}

export function rebuildDefaultsTabs(models) {
  const bar = el("defaultsModelTabs");
  if (!bar) return;
  const activeModel = (bar.querySelector(".sub-tab-btn.active") || {}).dataset
    ? bar.querySelector(".sub-tab-btn.active").dataset.model : "";
  bar.innerHTML = "";
  models.forEach(m => {
    const btn = document.createElement("button");
    btn.className = "sub-tab-btn";
    btn.dataset.model = m.unet;
    btn.textContent = m.name || m.unet;
    btn.title = m.unet;
    bar.appendChild(btn);
  });
  const chain = document.createElement("button");
  chain.className = "sub-tab-btn";
  chain.dataset.model = "chain";
  chain.textContent = "Chain";
  bar.appendChild(chain);
  const keep = [...bar.querySelectorAll(".sub-tab-btn")].find(b => b.dataset.model === activeModel);
  (keep || bar.querySelector(".sub-tab-btn")).classList.add("active");
}

function save() {
  const models = collect();
  const body = {
    paths: {
      comfy_root: el("modelsComfyRoot").value.trim(),
      comfy_python: el("modelsComfyPython").value.trim(),
      output_dir: el("modelsOutputDir").value.trim(),
      loras_root: el("modelsLorasRoot").value.trim(),
      comfy_host: el("modelsComfyHost").value.trim(),
    },
    model_dirs: (reg && reg.model_dirs) || {},
    models,
  };
  const btn = el("btnSaveModels");
  btn.disabled = true;
  saveRegistry(body).then(data => {
    btn.disabled = false;
    if (data.status !== "ok") {
      showToast(data.message || "Could not save", "error");
      return;
    }
    reg = data;
    mutableState.registryModels = (data.models || []).map(m => ({ ...m }));
    renderFolders();
    renderList();
    refreshAppFromRegistry(data);
    dirty = false;
    const warn = (data.warnings || []).length;
    showToast(data.message || "Models saved", warn ? "error" : "success");
    if (warn) {
      el("modelsFolderStatus").innerHTML =
        `<span class="warn">${data.warnings.map(w => `• ${w}`).join("<br>")}</span>`;
    }
  }).catch(err => {
    btn.disabled = false;
    showToast(`Could not save: ${err.message}`, "error");
  });
}

function addModel() {
  const models = collect();
  models.push({ name: "", unet: "", text_encoder: "", encoder_type: "", vae: "", steps: 8, cfg: 1.0 });
  mutableState.registryModels = models;
  renderList();
  dirty = true;
  const cards = el("modelsList").querySelectorAll(".model-card");
  const last = cards[cards.length - 1];
  if (last) {
    last.scrollIntoView({ block: "nearest" });
    const nameInput = last.querySelector(".model-name");
    if (nameInput) nameInput.focus();
  }
}

function scan() {
  // Re-read the folder with the path as typed, without saving the registry first.
  const root = el("modelsComfyRoot").value.trim();
  if (root && reg && root !== reg.paths.comfy_root) {
    const body = {
      paths: { ...reg.paths, comfy_root: root },
      model_dirs: reg.model_dirs || {},
      models: (reg.models || []).map(m => ({ ...m })),
    };
    el("modelsFolderStatus").textContent = "Scanning " + root + " …";
    saveRegistry(body).then(data => {
      if (data.status !== "ok") {
        showToast(data.message || "That folder did not work", "error");
        el("modelsFolderStatus").textContent = data.message || "Scan failed";
        return;
      }
      reg = data;
      renderFolders();
      renderList();
      refreshAppFromRegistry(data);
      showToast("Rescanned " + data.paths.comfy_root, "success");
    });
    return;
  }
  loadModelsTab(true);
}

function detect() {
  el("modelsFolderStatus").textContent = "Looking for a ComfyUI install…";
  detectComfy().then(data => {
    const hits = (data.candidates || []).filter(c => c.has_models || c.has_main);
    if (!hits.length) {
      el("modelsFolderStatus").innerHTML =
        '<span class="warn">No ComfyUI install found in the usual places — type its folder above.</span>';
      return;
    }
    const best = hits[0];
    el("modelsComfyRoot").value = best.path;
    if (best.python) el("modelsComfyPython").value = best.python;
    el("modelsFolderStatus").innerHTML = hits
      .map(c => `<span class="${c.path === best.path ? "ok" : "dim"}">${c.path}` +
        ` — ${c.models.unet} models, ${c.models.text_encoder} encoders, ${c.models.vae} VAEs</span>`)
      .join("<br>");
    showToast(hits.length === 1 ? "Found " + best.path : `Found ${hits.length} installs — the first is filled in`,
      "success");
  });
}

export function bindModelsTab() {
  if (!el("modelsPanel")) return;
  el("btnSaveModels").addEventListener("click", save);
  el("btnAddModel").addEventListener("click", addModel);
  el("btnScanModels").addEventListener("click", scan);
  el("btnDetectComfy").addEventListener("click", detect);
  el("btnToggleAdvanced").addEventListener("click", () => {
    el("modelsAdvanced").classList.toggle("hidden");
  });
}

// Rebuild the Defaults sub-tabs from the config the app already loaded (called once at startup).
export function seedDefaultsTabs(config) {
  const models = (config.unet_models || []).map(name => ({ name, unet: name }));
  rebuildDefaultsTabs(models);
}
