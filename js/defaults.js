/* defaults.js — defaults tab logic (sub-tabs, mode switching, save/reset) */

import * as state from "./state-v2.js?v=x54";
import { mutableState } from "./state-v2.js?v=x54";
import { fetchDefaults } from "./api.js?v=x54";
import { showToast, bindRange, fillSelect } from "./ui.js?v=x54";

export function getActiveDefaultsModel() {
  const active = document.querySelector("#defaultsModelTabs .sub-tab-btn.active");
  return active ? active.dataset.model : "qwen_image_2.1_int8_convrot.safetensors";
}

export function isChainDefaults() {
  return getActiveDefaultsModel() === "chain";
}

export function isChainAutoPostProcess() {
  return !!(state.chainAutoPostProcess && state.chainAutoPostProcess.checked);
}

export function loadDefaultsTab() {
  const model = getActiveDefaultsModel();
  if (model === "chain") {
    state.defaultsModeRow.classList.add("hidden");
    state.defaultsModelSections.classList.add("hidden");
    state.defaultsChainRow.classList.remove("hidden");
    if (state.chainColumns) state.chainColumns.classList.remove("hidden");
    if (state.chainAutoPPRow) state.chainAutoPPRow.classList.remove("hidden");
    const direction = state.chainDirection.value || "forward";
    fetchDefaults({ action: "load", direction })
      .then(data => {
        if (data.status !== "ok" || !data.chain) return;
        const c = data.chain;
        state.chainStage1Model.value = c.stage1.unet_name;
        state.chainStage2Model.value = c.stage2.unet_name;
        state.chainStage1Denoise.value = c.stage1.denoise;
        state.chainStage1DenoiseVal.textContent = c.stage1.denoise;
        state.chainStage2Denoise.value = c.stage2.denoise;
        state.chainStage2DenoiseVal.textContent = c.stage2.denoise;

        const ls1 = (data.loras_stage1 && data.loras_stage1.length > 0) ? data.loras_stage1 : ["none"];
        const ls2 = (data.loras_stage2 && data.loras_stage2.length > 0) ? data.loras_stage2 : ["none"];
        fillSelect(state.chainStage1Lora1Name, ls1);
        fillSelect(state.chainStage1Lora2Name, ls1);
        fillSelect(state.chainStage2Lora1Name, ls2);
        fillSelect(state.chainStage2Lora2Name, ls2);

        state.chainStage1Lora1Name.value = c.stage1.lora1_name || "none";
        state.chainStage1Lora1Strength.value = c.stage1.lora1_strength || 0.0;
        state.chainStage1Lora1StrengthVal.textContent = c.stage1.lora1_strength || 0.0;
        state.chainStage1Lora2Name.value = c.stage1.lora2_name || "none";
        state.chainStage1Lora2Strength.value = c.stage1.lora2_strength || 0.0;
        state.chainStage1Lora2StrengthVal.textContent = c.stage1.lora2_strength || 0.0;

        state.chainStage2Lora1Name.value = c.stage2.lora1_name || "none";
        state.chainStage2Lora1Strength.value = c.stage2.lora1_strength || 0.0;
        state.chainStage2Lora1StrengthVal.textContent = c.stage2.lora1_strength || 0.0;
        state.chainStage2Lora2Name.value = c.stage2.lora2_name || "none";
        state.chainStage2Lora2Strength.value = c.stage2.lora2_strength || 0.0;
        state.chainStage2Lora2StrengthVal.textContent = c.stage2.lora2_strength || 0.0;

        state.chainUpscale.value = c.stage2.upscale || 1.0;
        state.chainUpscaleVal.textContent = c.stage2.upscale || 1.0;

        state.chainStage1MP.value = c.stage1.mp || 1.54;
        state.chainStage1AR.value = c.stage1.ar || "9:16";

        if (state.chainStage1Sampler) state.chainStage1Sampler.value = c.stage1.sampler || "euler";
        if (state.chainStage1Scheduler) state.chainStage1Scheduler.value = c.stage1.scheduler || "simple";
        if (state.chainStage1Steps) {
          state.chainStage1Steps.value = c.stage1.steps || 8;
          state.chainStage1StepsVal.textContent = c.stage1.steps || 8;
        }
        if (state.chainStage1CFG) {
          state.chainStage1CFG.value = c.stage1.cfg || 1.0;
          state.chainStage1CFGVal.textContent = c.stage1.cfg || 1.0;
        }

        if (state.chainStage2Sampler) state.chainStage2Sampler.value = c.stage2.sampler || "euler";
        if (state.chainStage2Scheduler) state.chainStage2Scheduler.value = c.stage2.scheduler || "simple";
        if (state.chainStage2Steps) {
          state.chainStage2Steps.value = c.stage2.steps || 8;
          state.chainStage2StepsVal.textContent = c.stage2.steps || 8;
        }
        if (state.chainStage2CFG) {
          state.chainStage2CFG.value = c.stage2.cfg || 1.0;
          state.chainStage2CFGVal.textContent = c.stage2.cfg || 1.0;
        }

        mutableState.chainDefaults = c;
        mutableState.chainDefaultsDirection = direction;
      });
    return;
  }
  state.defaultsModeRow.classList.remove("hidden");
  state.defaultsModelSections.classList.remove("hidden");
  state.defaultsChainRow.classList.add("hidden");
  if (state.chainColumns) state.chainColumns.classList.add("hidden");
  if (state.chainAutoPPRow) state.chainAutoPPRow.classList.add("hidden");
  const mode = state.defaultsMode.value || "t2i";
  fetchDefaults({ action: "load", unet_name: model, mode })
    .then(data => {
      if (data.status !== "ok") return;
      const d = data.defaults || {};
      const lorasList = (data.loras && data.loras.length > 0) ? data.loras : ["none"];
      fillSelect(state.defaultsLora1Name, lorasList);
      fillSelect(state.defaultsLora2Name, lorasList);
      state.defaultsSampler.value = d.sampler || "euler";
      state.defaultsScheduler.value = d.scheduler || "simple";
      state.defaultsSteps.value = d.steps || 8;
      state.defaultsStepsVal.textContent = d.steps || 8;
      state.defaultsCFG.value = d.cfg || 1.0;
      state.defaultsCFGVal.textContent = d.cfg || 1.0;
      state.defaultsDenoise.value = d.denoise || 1.0;
      state.defaultsDenoiseVal.textContent = d.denoise || 1.0;
      state.defaultsMP.value = d.mp || 1.54;
      state.defaultsAR.value = d.ar || "9:16";
      state.defaultsLora1Name.value = d.lora1_name || "none";
      state.defaultsLora1Strength.value = d.lora1_strength || 0.0;
      state.defaultsLora1StrengthVal.textContent = d.lora1_strength || 0.0;
      state.defaultsLora2Name.value = d.lora2_name || "none";
      state.defaultsLora2Strength.value = d.lora2_strength || 0.0;
      state.defaultsLora2StrengthVal.textContent = d.lora2_strength || 0.0;
    });
}

export function saveDefaults() {
  const model = getActiveDefaultsModel();
  if (model === "chain") {
    const direction = state.chainDirection.value || "forward";
    const chainData = {
      stage1: {
        unet_name: state.chainStage1Model.value,
        denoise: parseFloat(state.chainStage1Denoise.value),
        mp: parseFloat(state.chainStage1MP.value),
        ar: state.chainStage1AR.value,
        sampler: state.chainStage1Sampler ? state.chainStage1Sampler.value : "euler",
        scheduler: state.chainStage1Scheduler ? state.chainStage1Scheduler.value : "simple",
        steps: state.chainStage1Steps ? parseInt(state.chainStage1Steps.value) : 8,
        cfg: state.chainStage1CFG ? parseFloat(state.chainStage1CFG.value) : 1.0,
        lora1_name: state.chainStage1Lora1Name.value,
        lora1_strength: parseFloat(state.chainStage1Lora1Strength.value),
        lora2_name: state.chainStage1Lora2Name.value,
        lora2_strength: parseFloat(state.chainStage1Lora2Strength.value),
      },
      stage2: {
        unet_name: state.chainStage2Model.value,
        denoise: parseFloat(state.chainStage2Denoise.value),
        sampler: state.chainStage2Sampler ? state.chainStage2Sampler.value : "euler",
        scheduler: state.chainStage2Scheduler ? state.chainStage2Scheduler.value : "simple",
        steps: state.chainStage2Steps ? parseInt(state.chainStage2Steps.value) : 8,
        cfg: state.chainStage2CFG ? parseFloat(state.chainStage2CFG.value) : 1.0,
        lora1_name: state.chainStage2Lora1Name.value,
        lora1_strength: parseFloat(state.chainStage2Lora1Strength.value),
        lora2_name: state.chainStage2Lora2Name.value,
        lora2_strength: parseFloat(state.chainStage2Lora2Strength.value),
        upscale: parseFloat(state.chainUpscale.value),
      },
    };
    fetchDefaults({ action: "save", direction, chain: chainData })
      .then(data => {
        showToast(data.message || "Chain defaults saved", data.status === "ok" ? "success" : "error");
        if (data.status === "ok") {
          mutableState.chainDefaults = chainData;
          mutableState.chainDefaultsDirection = direction;
        }
      });
    return;
  }
  const mode = state.defaultsMode.value || "t2i";
  const payload = {
    action: "save",
    unet_name: model,
    mode,
    defaults: {
      sampler: state.defaultsSampler.value,
      scheduler: state.defaultsScheduler.value,
      steps: parseInt(state.defaultsSteps.value),
      cfg: parseFloat(state.defaultsCFG.value),
      denoise: parseFloat(state.defaultsDenoise.value),
      mp: parseFloat(state.defaultsMP.value),
      ar: state.defaultsAR.value,
      lora1_name: state.defaultsLora1Name.value,
      lora1_strength: parseFloat(state.defaultsLora1Strength.value),
      lora2_name: state.defaultsLora2Name.value,
      lora2_strength: parseFloat(state.defaultsLora2Strength.value),
    },
  };
  fetchDefaults(payload)
    .then(data => {
      showToast(data.message || "Defaults saved", data.status === "ok" ? "success" : "error");
    });
}

export function resetDefaults() {
  const model = getActiveDefaultsModel();
  if (model === "chain") {
    const direction = state.chainDirection.value || "forward";
    fetchDefaults({ action: "reset", direction })
      .then(data => {
        if (data.status === "ok" && data.chain) {
          const c = data.chain;
          state.chainStage1Model.value = c.stage1.unet_name;
          state.chainStage2Model.value = c.stage2.unet_name;
          state.chainStage1Denoise.value = c.stage1.denoise;
          state.chainStage1DenoiseVal.textContent = c.stage1.denoise;
          state.chainStage2Denoise.value = c.stage2.denoise;
          state.chainStage2DenoiseVal.textContent = c.stage2.denoise;

          state.chainStage1MP.value = c.stage1.mp || 1.54;
          state.chainStage1AR.value = c.stage1.ar || "9:16";

          const ls1 = (data.loras_stage1 && data.loras_stage1.length > 0) ? data.loras_stage1 : ["none"];
          const ls2 = (data.loras_stage2 && data.loras_stage2.length > 0) ? data.loras_stage2 : ["none"];
          fillSelect(state.chainStage1Lora1Name, ls1);
          fillSelect(state.chainStage1Lora2Name, ls1);
          fillSelect(state.chainStage2Lora1Name, ls2);
          fillSelect(state.chainStage2Lora2Name, ls2);

          state.chainStage1Lora1Name.value = c.stage1.lora1_name || "none";
          state.chainStage1Lora1Strength.value = c.stage1.lora1_strength || 0.0;
          state.chainStage1Lora1StrengthVal.textContent = c.stage1.lora1_strength || 0.0;
          state.chainStage1Lora2Name.value = c.stage1.lora2_name || "none";
          state.chainStage1Lora2Strength.value = c.stage1.lora2_strength || 0.0;
          state.chainStage1Lora2StrengthVal.textContent = c.stage1.lora2_strength || 0.0;

          state.chainStage2Lora1Name.value = c.stage2.lora1_name || "none";
          state.chainStage2Lora1Strength.value = c.stage2.lora1_strength || 0.0;
          state.chainStage2Lora1StrengthVal.textContent = c.stage2.lora1_strength || 0.0;
          state.chainStage2Lora2Name.value = c.stage2.lora2_name || "none";
          state.chainStage2Lora2Strength.value = c.stage2.lora2_strength || 0.0;
          state.chainStage2Lora2StrengthVal.textContent = c.stage2.lora2_strength || 0.0;

          state.chainUpscale.value = c.stage2.upscale || 1.0;
          state.chainUpscaleVal.textContent = c.stage2.upscale || 1.0;

          if (state.chainStage1Sampler) state.chainStage1Sampler.value = c.stage1.sampler || "euler";
          if (state.chainStage1Scheduler) state.chainStage1Scheduler.value = c.stage1.scheduler || "simple";
          if (state.chainStage1Steps) {
            state.chainStage1Steps.value = c.stage1.steps || 8;
            state.chainStage1StepsVal.textContent = c.stage1.steps || 8;
          }
          if (state.chainStage1CFG) {
            state.chainStage1CFG.value = c.stage1.cfg || 1.0;
            state.chainStage1CFGVal.textContent = c.stage1.cfg || 1.0;
          }

          if (state.chainStage2Sampler) state.chainStage2Sampler.value = c.stage2.sampler || "euler";
          if (state.chainStage2Scheduler) state.chainStage2Scheduler.value = c.stage2.scheduler || "simple";
          if (state.chainStage2Steps) {
            state.chainStage2Steps.value = c.stage2.steps || 8;
            state.chainStage2StepsVal.textContent = c.stage2.steps || 8;
          }
          if (state.chainStage2CFG) {
            state.chainStage2CFG.value = c.stage2.cfg || 1.0;
            state.chainStage2CFGVal.textContent = c.stage2.cfg || 1.0;
          }

          mutableState.chainDefaults = c;
          mutableState.chainDefaultsDirection = direction;
        }
        showToast("Chain defaults reset", "success");
      });
    return;
  }
  const mode = state.defaultsMode.value || "t2i";
  fetchDefaults({ action: "reset", unet_name: model, mode })
    .then(data => {
      if (data.status === "ok" && data.defaults) {
        const d = data.defaults;
        state.defaultsSampler.value = d.sampler || "euler";
        state.defaultsScheduler.value = d.scheduler || "simple";
        state.defaultsSteps.value = d.steps || 8;
        state.defaultsStepsVal.textContent = d.steps || 8;
        state.defaultsCFG.value = d.cfg || 1.0;
        state.defaultsCFGVal.textContent = d.cfg || 1.0;
        state.defaultsDenoise.value = d.denoise || 1.0;
        state.defaultsDenoiseVal.textContent = d.denoise || 1.0;
        state.defaultsMP.value = d.mp || 1.54;
        state.defaultsAR.value = d.ar || "9:16";
        state.defaultsLora1Name.value = d.lora1_name || "none";
        state.defaultsLora1Strength.value = d.lora1_strength || 0.0;
        state.defaultsLora1StrengthVal.textContent = d.lora1_strength || 0.0;
        state.defaultsLora2Name.value = d.lora2_name || "none";
        state.defaultsLora2Strength.value = d.lora2_strength || 0.0;
        state.defaultsLora2StrengthVal.textContent = d.lora2_strength || 0.0;
      }
      showToast("Defaults reset to config", "success");
    });
}
