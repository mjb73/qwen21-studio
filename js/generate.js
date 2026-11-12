/* generate.js — job queue logic, polling, generation workflow, image upload handling */

import * as state from "./state-v2.js?v=x54";
import { mutableState } from "./state-v2.js?v=x54";
import { uploadImage, uploadReference, generateImage, fetchStatus } from "./api.js?v=x54";
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from "./constants.js?v=x54";
import {
  showToast,
  abbreviateModel
} from "./ui.js?v=x54";
import { startGeneratingAnimation, stopGeneratingAnimation, setOutputMode } from "./animation.js?v=x54";
import { updateDimensionVisibility, updateI2IDimensions } from "./dimensions.js?v=x54";
import * as postprocess from "./postprocess.js?v=x54";
import { isChainAutoPostProcess } from "./defaults.js?v=x54";


export function renderQueue() {
  if (!state.queueStripT2I || !state.queueStripStage2 || !state.queueBadge) return;

  state.queueStripT2I.innerHTML = "";
  state.queueStripStage2.innerHTML = "";

  const count = mutableState.jobQueue.length;
  state.queueBadge.textContent = count;
  state.queueBadge.classList.toggle("hidden", count === 0);

  const t2iJobs = mutableState.jobQueue.filter(j => !j.isStage2);
  const stage2Jobs = mutableState.jobQueue.filter(j => j.isStage2);

  const isChainMode = stage2Jobs.length > 0 || t2iJobs.some(j => j.chainConfig);
  const t2iLabel = state.queueSectionT2I.querySelector(".queue-section-label");
  const stage2Label = state.queueSectionStage2.querySelector(".queue-section-label");

  const firstT2IMode = t2iJobs[0]?.snapshot?.generation_mode || "T2I";
  const firstStage2Mode = stage2Jobs[0]?.snapshot?.generation_mode || "I2I";
  const stage1ModelName = t2iJobs[0]?.snapshot?.unet_name || "";
  const stage2ModelName = stage2Jobs[0]?.snapshot?.unet_name || "";
  const shortName = (name) => {
    if (name.includes("ernie")) return "ernie";
    if (name.includes("z_image") || name.includes("zturbo")) return "z-image";
    if (name.includes("anime")) return "z-anime";
    if (name.includes("krea")) return "krea-2";
    return name.replace(".safetensors", "");
  };
  if (t2iLabel) {
    t2iLabel.textContent = isChainMode ? `Stage 1 — T2I (${shortName(stage1ModelName)})` : firstT2IMode;
  }
  if (stage2Label) {
    stage2Label.textContent = isChainMode ? `Stage 2 — I2I (${shortName(stage2ModelName)})` : firstStage2Mode;
  }

  state.queueSectionT2I.classList.toggle("hidden", t2iJobs.length === 0);
  state.queueSectionStage2.classList.toggle("hidden", stage2Jobs.length === 0);

  function renderCard(job, container) {
    const card = document.createElement("div");
    card.className = `queue-card ${job.status} enter`;
    card.dataset.jobId = job.id;

    const promptText = (job.snapshot.positive_prompt || "").slice(0, 40);
    const dims = `${job.snapshot.width}x${job.snapshot.height}`;
    const model = abbreviateModel(job.snapshot.unet_name);
    const upscale = parseFloat(job.snapshot.upscale) || 1.0;
    const upscaleStr = upscale !== 1.0 ? ` &middot; ${upscale}x` : "";

    card.innerHTML = `
      <div class="qc-prompt" title="${job.snapshot.positive_prompt}">${promptText}</div>
      <div class="qc-meta"><span class="qc-model">${model} &middot; </span><span class="qc-dims">${dims}${upscaleStr}</span></div>
      <div class="qc-status">${job.status}</div>
    `;

    if (job.status === "waiting") {
      const removeBtn = document.createElement("button");
      removeBtn.className = "qc-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove from queue";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeJob(job.id);
      });
      card.appendChild(removeBtn);
    }

    container.appendChild(card);
  }

  t2iJobs.forEach(job => renderCard(job, state.queueStripT2I));
  stage2Jobs.forEach(job => renderCard(job, state.queueStripStage2));
}

export function removeJob(id) {
  const removed = mutableState.jobQueue.find(j => j.id === id);
  if (removed && removed.chainConfig) {
    mutableState.activeT2ICount--;
    if (mutableState.activeT2ICount <= 0) flushDeferredStage2();
  }
  mutableState.jobQueue = mutableState.jobQueue.filter(j => j.id !== id);
  renderQueue();
  if (!mutableState.isProcessing && mutableState.jobQueue.length > 0) {
    processQueue();
  }
}

/**
 * A finite number, or the fallback.
 *
 * This is the payload builder every submit goes through, and `parseInt("")` is NaN — which
 * `JSON.stringify` turns into `null`, so the request model rejects the job without naming the field.
 * Every numeric field here defaults instead.
 */
const num = (v, dflt = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

export function buildJobPayload(snapshot) {
  return {
    positive_prompt: snapshot.positive_prompt,
    width: Math.round(num(snapshot.width, 832)),
    height: Math.round(num(snapshot.height, 1664)),
    seed: Math.round(num(snapshot.seed, 0)),
    denoise: num(snapshot.denoise, 1.0),
    steps: Math.round(num(snapshot.steps, 8)),
    cfg: num(snapshot.cfg, 1.0),
    scheduler: snapshot.scheduler,
    sampler: snapshot.sampler,
    lora1_name: snapshot.lora1_name,
    lora1_strength: num(snapshot.lora1_strength, 0.0),
    lora2_name: snapshot.lora2_name,
    lora2_strength: num(snapshot.lora2_strength, 0.0),
    unet_name: snapshot.unet_name,
    clip_name: snapshot.clip_name,
    clip_type: snapshot.clip_type,
    vae_name: snapshot.vae_name,
    generation_mode: snapshot.generation_mode,
    input_image_filename: snapshot.input_image_filename,
    reference_images: snapshot.reference_images || [],
    dimension_mode: snapshot.dimension_mode,
    mp: num(snapshot.mp, 1.0),
    ar: snapshot.ar || "9:16",
    upscale: num(snapshot.upscale, 1.0),
    pag_scale: num(snapshot.pag_scale, 0.0),
  };
}

export function processQueue() {
  if (mutableState.isProcessing || mutableState.jobQueue.length === 0) {
    console.log("[processQueue] skipped — isProcessing:", mutableState.isProcessing, "queueLen:", mutableState.jobQueue.length);
    return;
  }
  mutableState.isProcessing = true;
  const job = mutableState.jobQueue[0];
  job.status = "running";
  renderQueue();
  startGeneratingAnimation();

  const payload = buildJobPayload(job.snapshot);
  console.log("[processQueue] submitting job", job.id);

  generateImage(payload)
    .then(data => {
      console.log("[processQueue] generateImage response:", data.status, data.prompt_id);
      if (data.status === "ok" && data.prompt_id) {
        state.status.value = "Generation started...";
        startPolling(job.id, data.prompt_id);
      } else {
        state.status.value = data.message || "Error";
        showToast(data.message || "Generation failed", "error");
        job.status = "error";
        renderQueue();
        setTimeout(() => {
          mutableState.jobQueue = mutableState.jobQueue.filter(j => j.id !== job.id);
          renderQueue();
          mutableState.isProcessing = false;
          processQueue();
        }, 2000);
      }
    })
    .catch(err => {
      console.error("[processQueue] generateImage error:", err);
      state.status.value = "Error: " + err.message;
      showToast("Connection error", "error");
      job.status = "error";
      renderQueue();
      setTimeout(() => {
        mutableState.jobQueue = mutableState.jobQueue.filter(j => j.id !== job.id);
        renderQueue();
        mutableState.isProcessing = false;
        processQueue();
      }, 2000);
    });
  }

export function setGenerateStatus(msg) {
  if (!state.generateStatus) return;
  if (msg) {
    state.generateStatus.textContent = msg;
    state.generateStatus.classList.remove("hidden");
  } else {
    state.generateStatus.classList.add("hidden");
    state.generateStatus.textContent = "";
  }
}

export async function deferStage2(job, imageUrl) {
  console.log("[CHAIN] deferStage2 starting for job", job.id, "imageUrl:", imageUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    console.log("[CHAIN] fetch image status:", resp.status);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    const formData = new FormData();
    formData.append("file", new File([blob], "chain_output.png", { type: blob.type }));
    const uploadData = await uploadImage(formData);
    console.log("[CHAIN] uploadImage response:", uploadData.status, uploadData.filename);

    if (uploadData.status === "ok") {
      mutableState.deferredStage2.push({
        snapshot: { ...job.snapshot, chainConfig: job.chainConfig },
        input_image_filename: uploadData.filename,
        chainDefaults: mutableState.chainDefaults,
        chainDefaultsDirection: mutableState.chainDefaultsDirection,
      });
      console.log("[CHAIN] Stage 2 deferred for job", job.id, "deferred count:", mutableState.deferredStage2.length);
      return true;
    } else {
      throw new Error(uploadData.message || "Upload error");
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("[CHAIN] Stage 2 defer failed:", err);
    showToast("Stage 2 defer failed: " + err.message, "error");
    throw err;
  }
}

export function flushDeferredStage2() {
  console.log("[CHAIN] flushDeferredStage2 called, deferred count:", mutableState.deferredStage2.length, "isProcessing:", mutableState.isProcessing);
  if (mutableState.deferredStage2.length === 0) {
    console.log("[CHAIN] deferredStage2 empty, nothing to flush");
    return;
  }
  const count = mutableState.deferredStage2.length;
  for (const item of mutableState.deferredStage2) {
    const reversed = item.snapshot.chainConfig?.stage2?.reversed;
    const ernieToKrea2 = item.snapshot.chainConfig?.stage2?.ernieToKrea2;
    const krea2ToErnie = item.snapshot.chainConfig?.stage2?.krea2ToErnie;
    const ernieUpscale = item.snapshot.chainConfig?.stage2?.ernieUpscale;
    console.log("[CHAIN] creating stage2 job, reversed:", reversed, "ernieToKrea2:", ernieToKrea2, "krea2ToErnie:", krea2ToErnie, "ernieUpscale:", ernieUpscale, "chainConfig:", item.snapshot.chainConfig);
    // Resolve stage2 config: use live panel values > defaults > fallback
    const captured = item.snapshot.chainConfig?.stage2;
    console.log("[CHAIN] captured stage2 live values:", captured);
    let stage2Config = captured?._effectiveStage2;
    if (!stage2Config) {
      // Phase 2 is always I2I. Pull from cd.stage2 regardless of direction.
      const cd = item.chainDefaults || {};
      stage2Config = cd.stage2 || {};
    }
    const stage2Snapshot = {
      ...item.snapshot,
      positive_prompt: item.snapshot.positive_prompt,
      generation_mode: "I2I",
      input_image_filename: item.input_image_filename,
      // Stage 2 renders from stage 1's own pixels; the original references belong to the first pass
      // (and stage 2 may well be a non-2.1 model, which has no image slots at all).
      reference_images: [],
      // Use captured live panel values first (user may have tweaked), then config, then fallback from presets
      denoise: captured?.denoise ?? stage2Config.denoise ?? 0.5,
      sampler: captured?.sampler || stage2Config.sampler || "euler",
      scheduler: captured?.scheduler || stage2Config.scheduler || "simple",
      steps: captured?.steps ?? stage2Config.steps ?? 8,
      cfg: captured?.cfg ?? stage2Config.cfg ?? 1.0,
      dimension_mode: "Direct",
      upscale: captured?.upscale ?? stage2Config.upscale ?? 1.0,
      lora1_name: captured?.lora1_name || stage2Config.lora1_name || "none",
      lora1_strength: captured?.lora1_strength ?? stage2Config.lora1_strength ?? 0.0,
      lora2_name: captured?.lora2_name || stage2Config.lora2_name || "none",
      lora2_strength: captured?.lora2_strength ?? stage2Config.lora2_strength ?? 0.0,
    };
    // The server handles upscale internally via ImageScaleBy — don't double-apply it here.
    if (ernieToKrea2) {
      // Ernie -> Krea2: Stage 2 is Krea-2 (I2I)
      stage2Snapshot.unet_name = "krea2_turbo_fp8_scaled.safetensors";
      stage2Snapshot.clip_name = "qwen3vl_4b_fp8_scaled.safetensors";
      stage2Snapshot.clip_type = "krea2";
      stage2Snapshot.vae_name = "qwen_image_vae.safetensors";
      // Krea-2 typically has no LoRAs in the preset
      stage2Snapshot.lora1_name = captured?.lora1_name || stage2Config.lora1_name || "none";
      stage2Snapshot.lora1_strength = captured?.lora1_strength !== undefined ? captured.lora1_strength : (stage2Config.lora1_strength !== undefined ? stage2Config.lora1_strength : 0.0);
      stage2Snapshot.lora2_name = captured?.lora2_name || stage2Config.lora2_name || "none";
      stage2Snapshot.lora2_strength = captured?.lora2_strength !== undefined ? captured.lora2_strength : (stage2Config.lora2_strength !== undefined ? stage2Config.lora2_strength : 0.0);
    } else if (reversed) {
      // Reversed: Stage 2 is z-image turbo (I2I)
      stage2Snapshot.unet_name = "z_image_turbo_bf16.safetensors";
      stage2Snapshot.clip_name = "qwen_3_4b.safetensors";
      stage2Snapshot.clip_type = "lumina2";
      stage2Snapshot.vae_name = "Turbo_z_ae.safetensors";
      // Use captured live panel values, then config defaults, then hardcoded fallback
      stage2Snapshot.lora1_name = captured?.lora1_name || stage2Config.lora1_name || "zturbo/char/K@te_20260211104109.safetensors";
      stage2Snapshot.lora1_strength = captured?.lora1_strength !== undefined ? captured.lora1_strength : (stage2Config.lora1_strength !== undefined ? stage2Config.lora1_strength : 0.6);
      stage2Snapshot.lora2_name = captured?.lora2_name || stage2Config.lora2_name || "zturbo/style/JabZ - ZIT .safetensors";
      stage2Snapshot.lora2_strength = captured?.lora2_strength !== undefined ? captured.lora2_strength : (stage2Config.lora2_strength !== undefined ? stage2Config.lora2_strength : 0.35);
    } else {
      // Forward, Krea2->Ernie, or Ernie->Ernie upscale: Stage 2 is Ernie (I2I)
      stage2Snapshot.unet_name = "ernie-image-turbo.safetensors";
      stage2Snapshot.clip_name = "ministral-3-3b.safetensors";
      stage2Snapshot.clip_type = "flux2";
      stage2Snapshot.vae_name = "flux2-vae.safetensors";
      stage2Snapshot.lora1_name = captured?.lora1_name || stage2Config.lora1_name || "ernie/ernie-anime-v1.safetensors";
      stage2Snapshot.lora1_strength = captured?.lora1_strength !== undefined ? captured.lora1_strength : (stage2Config.lora1_strength !== undefined ? stage2Config.lora1_strength : 0.35);
      stage2Snapshot.lora2_name = captured?.lora2_name || stage2Config.lora2_name || "none";
      stage2Snapshot.lora2_strength = captured?.lora2_strength !== undefined ? captured.lora2_strength : (stage2Config.lora2_strength !== undefined ? stage2Config.lora2_strength : 0.0);
    }
    delete stage2Snapshot.chainConfig;
    const stage2Job = {
      id: mutableState.nextJobId++,
      status: "waiting",
      snapshot: stage2Snapshot,
      timestamp: Date.now(),
      isStage2: true,
    };
    mutableState.jobQueue.push(stage2Job);
    console.log("[CHAIN] pushed stage2 job", stage2Job.id, "queue len:", mutableState.jobQueue.length);
  }
  mutableState.deferredStage2 = [];
  renderQueue();
  showToast(`Queued ${count} Stage 2 job(s)`, "success");
  console.log("[CHAIN] flush complete, isProcessing:", mutableState.isProcessing);
  if (!mutableState.isProcessing) processQueue();
}

export function startPolling(jobId, prompt_id) {
  let attempts = 0;
  const maxAttempts = MAX_POLL_ATTEMPTS;

  if (mutableState.pollInterval) clearInterval(mutableState.pollInterval);

  mutableState.pollInterval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(mutableState.pollInterval);
      state.status.value = "Generation timed out";
      showToast("Generation timed out", "error");
      finishJob(jobId, "error");
      return;
    }

    fetchStatus(prompt_id)
      .then(async data => {
        if (data.state === "done") {
          clearInterval(mutableState.pollInterval);
          const job = mutableState.jobQueue.find(j => j.id === jobId);
          console.log("[CHAIN] Stage 1 done, job found:", !!job, "chainConfig:", !!job?.chainConfig);
          if (job && job.chainConfig) {
            state.status.value = "Stage 1 complete — preparing stage 2...";
            deferStage2(job, data.image_url)
              .then(() => {
                console.log("[CHAIN] deferStage2 complete, activeT2ICount:", mutableState.activeT2ICount);
                mutableState.activeT2ICount--;
                if (mutableState.activeT2ICount <= 0) flushDeferredStage2();
                setOutputMode('stage1');
                if (state.stage1OutputImage) state.stage1OutputImage.src = data.image_url;
                state.status.value = data.status_msg || `Success: ${data.filename}`;
                showToast("Stage 1 complete — starting stage 2...", "success");
                // Tell the assistant which card produced this render.
                window.__ernieReportRender?.({
                  filename: data.filename, url: data.image_url, stage: 1,
                });
                finishJob(jobId, "done");
              })
              .catch(() => {
                state.status.value = "Stage 2 preparation failed";
                finishJob(jobId, "error");
              });
          } else {
            setOutputMode('final');
            // No Output tab any more: the picture is announced to PhotoCraft AI and opened there, so
            // there is no in-engine <img> to point at (the element is gone).
            if (state.outputImage) state.outputImage.src = data.image_url;
            postprocess.onImageSet();
            // Auto-apply post-processing if chain-mode toggle is enabled
            if (isChainAutoPostProcess()) {
              try {
                await postprocess.applyPostProcess();
              } catch (err) {
                console.error("Auto post-process failed:", err);
              }
            }
            state.status.value = data.status_msg || `Success: ${data.filename}`;
            showToast("Image generated!", "success");
            window.__ernieReportRender?.({
              filename: data.filename, url: data.image_url, stage: 2,
            });
            finishJob(jobId, "done");
          }
        } else if (data.state === "error") {
          clearInterval(mutableState.pollInterval);
          const job = mutableState.jobQueue.find(j => j.id === jobId);
          if (job && job.chainConfig) {
            mutableState.activeT2ICount--;
            if (mutableState.activeT2ICount <= 0) flushDeferredStage2();
          }
          state.status.value = "Error: " + (data.message || "Unknown error");
          showToast(data.message || "Generation error", "error");
          finishJob(jobId, "error");
        } else if (data.queue) {
          state.status.value = `Queued (${data.queue}) — ${attempts * 2}s elapsed`;
        } else {
          state.status.value = `Running — ${attempts * 2}s elapsed`;
        }
      })
      .catch(() => {
        // Keep polling on transient errors
      });
  }, POLL_INTERVAL_MS);
}

export function finishJob(jobId, finalStatus) {
  console.log("[CHAIN] finishJob called", jobId, finalStatus, "queue:", mutableState.jobQueue.map(j => ({ id: j.id, status: j.status, isStage2: j.isStage2 })));
  const job = mutableState.jobQueue.find(j => j.id === jobId);
  if (job) job.status = finalStatus;
  renderQueue();
  stopGeneratingAnimation();

  if (finalStatus === "error") {
    setOutputMode('placeholder');
  }

  setTimeout(() => {
    const card = document.querySelector(`[data-job-id="${jobId}"]`);
    if (card) {
      card.classList.remove("enter");
      card.classList.add("leave");
      let handled = false;
      const cleanup = () => {
        if (handled) return;
        handled = true;
        mutableState.jobQueue = mutableState.jobQueue.filter(j => j.id !== jobId);
        console.log("[CHAIN] finishJob cleanup removed job", jobId, "queue now:", mutableState.jobQueue.map(j => ({ id: j.id, status: j.status, isStage2: j.isStage2 })));
        renderQueue();
        mutableState.isProcessing = false;
        processQueue();
      };
      card.addEventListener("animationend", cleanup, { once: true });
      // Fallback in case animationend doesn't fire (reduced motion, throttled tabs, etc.)
      setTimeout(cleanup, 600);
    } else {
      mutableState.jobQueue = mutableState.jobQueue.filter(j => j.id !== jobId);
      console.log("[CHAIN] finishJob (no card) removed job", jobId, "queue now:", mutableState.jobQueue.map(j => ({ id: j.id, status: j.status, isStage2: j.isStage2 })));
      renderQueue();
      mutableState.isProcessing = false;
      processQueue();
    }
  }, finalStatus === "done" ? 2000 : 500);
}

export function resetGenerateBtn() {
  state.btnGenerate.disabled = false;
  state.btnGenerate.textContent = "Generate Image";
}

export function handleImageUpload(file) {
  if (!file || !file.type.startsWith("image/")) return Promise.resolve(false);

  const objectUrl = URL.createObjectURL(file);

  // Resolves when the picture's own size is known. The panel pulls the editor's document right
  // before Generate, so the caller has to be able to wait for that: I2I derives its dimensions
  // from the source, and submitting with the previous picture's aspect ratio is a silent miss.
  let settleDims;
  const dimsReady = new Promise((res) => { settleDims = res; });

  mutableState._detectorImg = new Image();
  mutableState._detectorImg.onload = () => {
    const actualW = mutableState._detectorImg.naturalWidth;
    const actualH = mutableState._detectorImg.naturalHeight;
    mutableState.detectedImageAR = actualW / actualH;
    mutableState.sourceImageSize = [actualW, actualH];
    const actualMP = (actualW * actualH) / 1_000_000;
    mutableState.originalImageMP = actualMP;
    state.mpInput.value = parseFloat(actualMP.toFixed(3));
    state.width.value = actualW;
    state.height.value = actualH;
    URL.revokeObjectURL(objectUrl);
    mutableState._detectorImg = null;
    if (state.generationMode.value === "I2I") {
      updateDimensionVisibility();
      updateI2IDimensions();
    }
    settleDims(true);
  };
  mutableState._detectorImg.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    mutableState._detectorImg = null;
    showToast("Could not read image dimensions", "error");
    settleDims(false);
  };
  mutableState._detectorImg.src = objectUrl;

  // No thumbnail: the source picture is not shown here (PhotoCraft is where the picture lives, and
  // the file input already names the file). Only its size and aspect ratio are read from it.

  const formData = new FormData();
  formData.append("file", file);

  const uploaded = uploadImage(formData)
    .then(data => {
      if (data.status === "ok") {
        mutableState.inputImageFilename = data.filename;
        showToast("Image uploaded", "success");
        return true;
      }
      showToast(data.message || "Upload failed", "error");
      return false;
    })
    .catch(() => {
      showToast("Upload error", "error");
      return false;
    });

  return Promise.all([uploaded, dimsReady]).then(([ok]) => ok);
}

/**
 * Ask the surrounding PhotoCraft AI panel for the picture open in the editor.
 *
 * The panel is a different origin, so this is a postMessage round-trip, not a fetch: the panel
 * reads the document out of PhotoCraft (doc_export, so unsaved edits are included) and posts the
 * PNG back as a transferred ArrayBuffer. Standalone (no parent) there is no editor to ask.
 */
export function pullFromPhotoCraft(timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error("Not inside the PhotoCraft AI panel — no editor to read from."));
      return;
    }
    // Only the 2.1 encoder has image_2 … image_16. Ask the panel for the document's layer
    // references only when the selected model can take them, so a Krea/ERNIE/Z-Image edit stays a
    // single image (and never pays for exports it cannot use).
    const wantsRefs = supportsReferences(state.unetName && state.unetName.value,
                                        state.clipType && state.clipType.value);
    const id = "pc-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    let timer = null;
    const finish = (fn, arg) => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      fn(arg);
    };
    function onMessage(ev) {
      const d = ev.data;
      if (!d || d.type !== "photocraft-ai-source" || d.id !== id) return;
      if (d.error) { finish(reject, new Error(d.error)); return; }
      const type = d.mime || "image/png";
      let file;
      try {
        file = new File([d.buffer], d.name || "photocraft.png", { type });
      } catch (e) {
        finish(reject, new Error("PhotoCraft sent a picture that could not be read"));
        return;
      }
      // Which document it came out of: the panel hands the render back into that same document,
      // as a layer above the picture it was derived from.
      file.photocraftDoc = d.doc || "";
      file.photocraftSize = (d.width && d.height) ? [d.width, d.height] : null;
      // Extra references the panel pulled out of the document's layers (image 2, image 3 …). Each is
      // {slot, name, buffer}; they are uploaded separately and become the encoder's image_N slots.
      file.photocraftRefs = Array.isArray(d.refs) ? d.refs : [];
      // Layers the panel saw but did not export because this model takes one image only.
      file.photocraftIgnored = Array.isArray(d.ignoredRefs) ? d.ignoredRefs : [];
      finish(resolve, file);
    }
    timer = setTimeout(
      () => finish(reject, new Error("PhotoCraft did not hand the picture over in time")),
      timeoutMs);
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "photocraft-ai-want-source", id, references: wantsRefs }, "*");
  });
}

/** image_2 … image_16 exist on the Qwen-Image 2.1 encoder and nowhere else. */
export function supportsReferences(unet, clipType) {
  return String(clipType || "") === "qwen_image" && String(unet || "").toLowerCase().includes("2.1");
}

/**
 * Does this model take a picture at all?
 *
 * MOSS-Image is text-to-image only: `moss_image` has no image input and no LoadImage node in its
 * graph (its docs put a reference picture on the prompt upsampler, never on the model), so an I2I
 * job on it would sample without ever seeing the source. The Generation Mode select does not offer
 * I2I for it, and the server refuses the job in the same words as a backstop.
 */
export function takesImageInput(unet, clipType) {
  return String(clipType || "") !== "moss_image";
}

/**
 * Upload the references that came with a PhotoCraft pull as image_2 … image_N.
 *
 * The panel decides which layers are references (a layer named "image 2", "image 3" …) and hands
 * each one over as {slot, name, buffer}. Nothing here interprets the names: the slot number is the
 * mapping, so the prompt's "image 2" means that layer.
 */
export async function uploadReferenceFiles(refs, ignored) {
  const list = (Array.isArray(refs) ? refs : []).filter(r => r && r.buffer);
  mutableState.referenceFilenames = [];
  mutableState.ignoredRefLayers = Array.isArray(ignored) ? ignored : [];
  const failures = [];
  for (const ref of list) {
    const slot = parseInt(ref.slot, 10) || 2;
    const blob = new Blob([ref.buffer], { type: ref.mime || "image/png" });
    const formData = new FormData();
    formData.append("file", blob, ref.name || `image_${slot}.png`);
    try {
      const data = await uploadReference(formData, slot);
      if (data.status === "ok") {
        mutableState.referenceFilenames.push({
          slot,
          name: ref.name || `image_${slot}`,
          filename: data.filename,
          width: data.width,
          height: data.height,
        });
      } else {
        failures.push(`image ${slot}: ${data.message || "upload failed"}`);
      }
    } catch (e) {
      failures.push(`image ${slot}: ${e.message || "upload error"}`);
    }
  }
  mutableState.referenceFilenames.sort((a, b) => a.slot - b.slot);
  renderRefStrip();
  if (failures.length) showToast("Reference upload failed — " + failures.join("; "), "error");
  return mutableState.referenceFilenames;
}

export function clearReferences() {
  mutableState.referenceFilenames = [];
  mutableState.ignoredRefLayers = [];
  renderRefStrip();
}

/** The line under image 1 naming what the next job will send as image_2, image_3 … */
export function renderRefStrip() {
  const strip = state.refStrip;
  if (!strip) return;
  const refs = mutableState.referenceFilenames || [];
  const ignored = mutableState.ignoredRefLayers || [];
  if (!refs.length && !ignored.length) {
    strip.innerHTML = "";
    strip.style.display = "none";
    return;
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  strip.style.display = "flex";
  strip.innerHTML = refs
    .map(r => {
      // The layer is usually called "image 2" too, which would read "image 2 image 2": keep only
      // what the name adds beyond the slot ("image 2 — red jacket" -> "red jacket").
      const extra = String(r.name || "")
        .replace(/^\s*(?:image|img|picture|ref|input)\s*[_\-–]?\s*\d{1,2}\b\s*[:·\-–—]*\s*/i, "")
        .trim();
      const dims = r.width && r.height ? ` <span class="ref-dims">${r.width}×${r.height}</span>` : "";
      const label = extra ? ` ${esc(extra)}` : "";
      return `<span class="ref-chip" title="${esc(r.name)}">` +
             `<b>image ${r.slot}</b>${label}${dims}</span>`;
    })
    .join("") +
    (ignored.length
      ? `<span class="ref-note">${ignored.map(esc).join(", ")} not sent — ` +
        `${esc(abbreviateModel(state.unetName ? state.unetName.value : ""))} takes one image</span>`
      : "");
}
