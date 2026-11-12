/* state.js — all state variables, constants, and DOM element references */

// Mutable runtime state lives inside this object so imports can mutate it
// (module-namespace objects may be frozen in file:// contexts, e.g. inside
// wrapper iframes, so exported `let` bindings cannot be reassigned).
// Every parameter is a plain number field now, so it shows its own value and the little readout
// span that used to sit under each slider is gone. The many `state.xVal.textContent = v` mirrors
// still run (presets, restores, defaults), so they write here instead of into a null element.
const readoutSink = Object.freeze({
  get textContent() { return ""; },
  set textContent(_value) {},
});

export const mutableState = {
  config: null,
  toastTimeout: null,
  cursorTimeout: null,
  pollInterval: null,
  inputImageFilename: null,
  sourceImageSize: null,   // exact [w, h] of the loaded I2I source picture
  // image_2 … image_N sent with the next job: [{slot, name, filename}] uploaded from the panel's
  // layers. Empty means a plain single-image edit (today's behaviour).
  referenceFilenames: [],
  // Layers named image 2, image 3 … that were not exported because the model takes one image only.
  ignoredRefLayers: [],
  detectedImageAR: null,

  jobQueue: [],
  isProcessing: false,
  nextJobId: 1,
  activeT2ICount: 0,
  deferredStage2: [],

  modelUserSettings: {},
  chainDefaults: null,
  chainDefaultsDirection: null,

  _savedT2IDims: null,
  _detectorImg: null,

  cropCtx: null,
  isDrawing: false,
  isDragging: false,
  cropStart: { x: 0, y: 0 },
  cropEnd: { x: 0, y: 0 },
  dragStartMouse: { x: 0, y: 0 },
  dragStartRect: { x: 0, y: 0, w: 0, h: 0 },
};

export const cursorGlow = document.getElementById("cursorGlow");
export const toast = document.getElementById("toast");
export const appTitle = document.getElementById("appTitle");

export const tabBtns = document.querySelectorAll(".tab-btn");
export const tabPanels = document.querySelectorAll(".tab-panel");

export const positivePrompt = document.getElementById("positivePrompt");
export const btnPastePrompt = document.getElementById("btnPastePrompt");
export const btnQwenTemplates = document.getElementById("btnQwenTemplates");
export const qwenTplMenu = document.getElementById("qwenTplMenu");

export const unetName = document.getElementById("unetName");
export const modelSelectWrap = document.getElementById("modelSelectWrap");
export const clipName = document.getElementById("clipName");
export const clipType = document.getElementById("clipType");
export const vaeName = document.getElementById("vaeName");
export const lora1Name = document.getElementById("lora1Name");
export const lora1Strength = document.getElementById("lora1Strength");
export const lora1StrengthVal = readoutSink;
export const lora2Name = document.getElementById("lora2Name");
export const lora2Strength = document.getElementById("lora2Strength");
export const lora2StrengthVal = readoutSink;
export const sampler = document.getElementById("sampler");
export const scheduler = document.getElementById("scheduler");
export const steps = document.getElementById("steps");
export const stepsVal = document.getElementById("stepsVal");
export const cfg = document.getElementById("cfg");
export const cfgVal = document.getElementById("cfgVal");
export const denoise = document.getElementById("denoise");
export const denoiseVal = readoutSink;

// Prompt tab per-mode generation fields (new)
export const promptSampler = document.getElementById("promptSampler");
export const promptScheduler = document.getElementById("promptScheduler");
export const promptSteps = document.getElementById("promptSteps");
export const promptStepsVal = readoutSink;
export const promptCFG = document.getElementById("promptCFG");
export const promptCFGVal = readoutSink;
export const promptPAG = document.getElementById("promptPAG");
export const promptPAGVal = readoutSink;
export const promptPAGWrap = document.getElementById("promptPAGWrap");
export const promptDenoiseWrap = document.getElementById("promptDenoiseWrap");
export const promptSeedWrap = document.getElementById("promptSeedWrap");
export const promptSamplingRow = document.getElementById("promptSamplingRow");
export const promptProfile = document.getElementById("promptProfile");
export const profileRow = document.getElementById("profileRow");
export const promptParamsRow = document.getElementById("promptParamsRow");
export const promptLora1Row = document.getElementById("promptLora1Row");
export const promptLora2Row = document.getElementById("promptLora2Row");
export const mpLabel = document.getElementById("mpLabel");
export const arLabel = document.getElementById("arLabel");

export const generationMode = document.getElementById("generationMode");
export const dimensionMode = document.getElementById("dimensionMode");
export const inputImage = document.getElementById("inputImage");
export const inputImageWrap = document.getElementById("inputImageWrap");
export const pcSource = document.getElementById("pcSource");
export const pcSourceLabel = document.getElementById("pcSourceLabel");
export const pcSourceWrap = document.getElementById("pcSourceWrap");
export const refStrip = document.getElementById("refStrip");
export const width = document.getElementById("width");
export const height = document.getElementById("height");
export const seed = document.getElementById("seed");
export const btnRandomSeed = document.getElementById("btnRandomSeed");
export const mpInput = document.getElementById("mpInput");
export const arInput = document.getElementById("arInput");
export const mpArRow = document.getElementById("mpArRow");
export const calcDisplay = document.getElementById("calcDisplay");
export const calcDisplayWrap = document.getElementById("calcDisplayWrap");
export const outputImage = document.getElementById("outputImage");
export const outputPlaceholder = document.getElementById("outputPlaceholder");
export const outputWrap = document.getElementById("outputWrap");
export const stage1OutputBlock = document.getElementById("stage1OutputBlock");
export const stage1OutputImage = document.getElementById("stage1OutputImage");
export const outputGlassPanel = outputWrap ? outputWrap.closest(".glass-panel") : null;
export const outputSectionHeader = outputGlassPanel ? outputGlassPanel.querySelector(".section-header") : null;
export const generatingCanvas = document.getElementById("generatingCanvas");
export const status = document.getElementById("status");

export const queueStripT2I = document.getElementById("queueStripT2I");
export const queueStripStage2 = document.getElementById("queueStripStage2");
export const queueSectionT2I = document.getElementById("queueSectionT2I");
export const queueSectionStage2 = document.getElementById("queueSectionStage2");
export const queueBadge = document.getElementById("queueBadge");
export const generateStatus = document.getElementById("generateStatus");

export const btnGenerate = document.getElementById("btnGenerate");
export const btnRefreshModels = document.getElementById("btnRefreshModels");
export const btnOpenOutput = document.getElementById("btnOpenOutput");
export const btnResetPrompt = document.getElementById("btnResetPrompt");

export const defaultsModelTabs = document.querySelectorAll("#defaultsModelTabs .sub-tab-btn");
export const defaultsMode = document.getElementById("defaultsMode");
export const defaultsModeRow = document.getElementById("defaultsModeRow");
export const defaultsChainRow = document.getElementById("defaultsChainRow");
export const chainColumns = document.getElementById("chainColumns");
export const chainUpscale = document.getElementById("chainUpscale");
export const chainUpscaleVal = readoutSink;
export const chainStage1MP = document.getElementById("chainStage1MP");
export const chainStage1AR = document.getElementById("chainStage1AR");
export const defaultsModelSections = document.getElementById("defaultsModelSections");
export const chainDirection = document.getElementById("chainDirection");
export const chainStage1Model = document.getElementById("chainStage1Model");
export const chainStage2Model = document.getElementById("chainStage2Model");
export const chainStage1Denoise = document.getElementById("chainStage1Denoise");
export const chainStage1DenoiseVal = readoutSink;
export const chainStage2Denoise = document.getElementById("chainStage2Denoise");
export const chainStage2DenoiseVal = readoutSink;
export const chainStage1Lora1Name = document.getElementById("chainStage1Lora1Name");
export const chainStage1Lora1Strength = document.getElementById("chainStage1Lora1Strength");
export const chainStage1Lora1StrengthVal = readoutSink;
export const chainStage1Lora2Name = document.getElementById("chainStage1Lora2Name");
export const chainStage1Lora2Strength = document.getElementById("chainStage1Lora2Strength");
export const chainStage1Lora2StrengthVal = readoutSink;
export const chainStage2Lora1Name = document.getElementById("chainStage2Lora1Name");
export const chainStage2Lora1Strength = document.getElementById("chainStage2Lora1Strength");
export const chainStage2Lora1StrengthVal = readoutSink;
export const chainStage2Lora2Name = document.getElementById("chainStage2Lora2Name");
export const chainStage2Lora2Strength = document.getElementById("chainStage2Lora2Strength");
export const chainStage2Lora2StrengthVal = readoutSink;
export const chainStage1Sampler = document.getElementById("chainStage1Sampler");
export const chainStage1Scheduler = document.getElementById("chainStage1Scheduler");
export const chainStage1Steps = document.getElementById("chainStage1Steps");
export const chainStage1StepsVal = readoutSink;
export const chainStage1CFG = document.getElementById("chainStage1CFG");
export const chainStage1CFGVal = readoutSink;
export const chainStage2Sampler = document.getElementById("chainStage2Sampler");
export const chainStage2Scheduler = document.getElementById("chainStage2Scheduler");
export const chainStage2Steps = document.getElementById("chainStage2Steps");
export const chainStage2StepsVal = readoutSink;
export const chainStage2CFG = document.getElementById("chainStage2CFG");
export const chainStage2CFGVal = readoutSink;
export const chainAutoPostProcess = document.getElementById("chainAutoPostProcess");
export const chainAutoPPRow = document.getElementById("chainAutoPPRow");
export const defaultsSampler = document.getElementById("defaultsSampler");
export const defaultsScheduler = document.getElementById("defaultsScheduler");
export const defaultsSteps = document.getElementById("defaultsSteps");
export const defaultsStepsVal = readoutSink;
export const defaultsCFG = document.getElementById("defaultsCFG");
export const defaultsCFGVal = readoutSink;
export const defaultsDenoise = document.getElementById("defaultsDenoise");
export const defaultsDenoiseVal = readoutSink;
export const defaultsMP = document.getElementById("defaultsMP");
export const defaultsAR = document.getElementById("defaultsAR");
export const defaultsClipName = document.getElementById("defaultsClipName");
export const defaultsClipType = document.getElementById("defaultsClipType");
export const defaultsVaeName = document.getElementById("defaultsVaeName");
export const defaultsLora1Name = document.getElementById("defaultsLora1Name");
export const defaultsLora1Strength = document.getElementById("defaultsLora1Strength");
export const defaultsLora1StrengthVal = readoutSink;
export const defaultsLora2Name = document.getElementById("defaultsLora2Name");
export const defaultsLora2Strength = document.getElementById("defaultsLora2Strength");
export const defaultsLora2StrengthVal = readoutSink;
export const btnSaveDefaults = document.getElementById("btnSaveDefaults");
export const btnResetDefaults = document.getElementById("btnResetDefaults");

export const pathsSection = document.getElementById("pathsSection");
export const pathComfyRoot = document.getElementById("pathComfyRoot");
export const pathComfyPython = document.getElementById("pathComfyPython");
export const pathOutputDir = document.getElementById("pathOutputDir");
export const pathLorasRoot = document.getElementById("pathLorasRoot");
export const pathComfyHost = document.getElementById("pathComfyHost");
export const btnSavePaths = document.getElementById("btnSavePaths");
export const btnResetPaths = document.getElementById("btnResetPaths");
export const defaultsBtnRow = document.getElementById("defaultsBtnRow");

export const btnView100 = document.getElementById("btnView100");
export const cropperModal = document.getElementById("cropperModal");
export const cropperBackdrop = document.getElementById("cropperBackdrop");
export const btnCropperClose = document.getElementById("btnCropperClose");
export const cropperImage = document.getElementById("cropperImage");
export const cropperCanvas = document.getElementById("cropperCanvas");
export const cropperStats = document.getElementById("cropperStats");
export const cropperPreviewPanel = document.getElementById("cropperPreviewPanel");
export const cropperPreviewCanvas = document.getElementById("cropperPreviewCanvas");
export const btnCopyCrop = document.getElementById("btnCopyCrop");
export const cropperAR = document.getElementById("cropperAR");

// Post-process DOM refs
export const postProcessPanel = document.getElementById("postProcessPanel");
export const ppShadows = document.getElementById("ppShadows");
export const ppShadowsVal = document.getElementById("ppShadowsVal");
export const ppHighlights = document.getElementById("ppHighlights");
export const ppHighlightsVal = document.getElementById("ppHighlightsVal");
export const ppOutMin = document.getElementById("ppOutMin");
export const ppOutMinVal = document.getElementById("ppOutMinVal");
export const ppOutMax = document.getElementById("ppOutMax");
export const ppOutMaxVal = document.getElementById("ppOutMaxVal");
export const ppContrast = document.getElementById("ppContrast");
export const ppContrastVal = document.getElementById("ppContrastVal");
export const ppSaturation = document.getElementById("ppSaturation");
export const ppSaturationVal = document.getElementById("ppSaturationVal");
export const ppTemperature = document.getElementById("ppTemperature");
export const ppTemperatureVal = document.getElementById("ppTemperatureVal");
export const ppBrilliance = document.getElementById("ppBrilliance");
export const ppBrillianceVal = document.getElementById("ppBrillianceVal");
export const ppVigExposure = document.getElementById("ppVigExposure");
export const ppVigExposureVal = document.getElementById("ppVigExposureVal");
export const ppVigHardness = document.getElementById("ppVigHardness");
export const ppVigHardnessVal = document.getElementById("ppVigHardnessVal");
export const ppVigScale = document.getElementById("ppVigScale");
export const ppVigScaleVal = document.getElementById("ppVigScaleVal");
export const ppVigShape = document.getElementById("ppVigShape");
export const ppVigShapeVal = document.getElementById("ppVigShapeVal");
export const ppSaveMode = document.getElementById("ppSaveMode");
export const ppEnabled = document.getElementById("ppEnabled");
export const ppControlsRow = document.getElementById("ppControlsRow");
export const outputVignetteCanvas = document.getElementById("outputVignetteCanvas");
export const btnApplyPostProcess = document.getElementById("btnApplyPostProcess");
export const btnResetPostProcess = document.getElementById("btnResetPostProcess");

// Chain Phase 1 / Phase 2 controls on Prompt tab
export const promptSingleControls = document.getElementById("promptSingleControls");
export const promptChainControls = document.getElementById("promptChainControls");

export const chainPromptP1Model = document.getElementById("chainPromptP1Model");
export const chainPromptP1Sampler = document.getElementById("chainPromptP1Sampler");
export const chainPromptP1Scheduler = document.getElementById("chainPromptP1Scheduler");
export const chainPromptP1Steps = document.getElementById("chainPromptP1Steps");
export const chainPromptP1StepsVal = readoutSink;
export const chainPromptP1CFG = document.getElementById("chainPromptP1CFG");
export const chainPromptP1CFGVal = readoutSink;
export const chainPromptP1Denoise = document.getElementById("chainPromptP1Denoise");
export const chainPromptP1DenoiseVal = readoutSink;
export const chainPromptP1MP = document.getElementById("chainPromptP1MP");
export const chainPromptP1AR = document.getElementById("chainPromptP1AR");
export const chainPromptP1Lora1Name = document.getElementById("chainPromptP1Lora1Name");
export const chainPromptP1Lora1Strength = document.getElementById("chainPromptP1Lora1Strength");
export const chainPromptP1Lora1StrengthVal = readoutSink;
export const chainPromptP1Lora2Name = document.getElementById("chainPromptP1Lora2Name");
export const chainPromptP1Lora2Strength = document.getElementById("chainPromptP1Lora2Strength");
export const chainPromptP1Lora2StrengthVal = readoutSink;

export const chainPromptP2Model = document.getElementById("chainPromptP2Model");
export const chainPromptP2Sampler = document.getElementById("chainPromptP2Sampler");
export const chainPromptP2Scheduler = document.getElementById("chainPromptP2Scheduler");
export const chainPromptP2Steps = document.getElementById("chainPromptP2Steps");
export const chainPromptP2StepsVal = readoutSink;
export const chainPromptP2CFG = document.getElementById("chainPromptP2CFG");
export const chainPromptP2CFGVal = readoutSink;
export const chainPromptP2Denoise = document.getElementById("chainPromptP2Denoise");
export const chainPromptP2DenoiseVal = readoutSink;
export const chainPromptP2TargetMP = document.getElementById("chainPromptP2TargetMP");
export const chainPromptP2Lora1Name = document.getElementById("chainPromptP2Lora1Name");
export const chainPromptP2Lora1Strength = document.getElementById("chainPromptP2Lora1Strength");
export const chainPromptP2Lora1StrengthVal = readoutSink;
export const chainPromptP2Lora2Name = document.getElementById("chainPromptP2Lora2Name");
export const chainPromptP2Lora2Strength = document.getElementById("chainPromptP2Lora2Strength");
export const chainPromptP2Lora2StrengthVal = readoutSink;

