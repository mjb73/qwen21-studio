/* constants.js — centralized magic values for the Ernie Generator */

export const MAX_SEED = 2147483647;

export const POLL_INTERVAL_MS = 2000;
export const MAX_POLL_ATTEMPTS = 240;  // 240 * 2s = 8 minutes

export const DIM_PIXEL_ROUNDING = 64;
export const TEXTAREA_MIN_HEIGHT = 160;
export const GAUGE_REFRESH_MS = 2000;

export const GENERATE_TIMEOUT_MS = 35000;

export const DEFAULT_STEPS = 8;
export const DEFAULT_CFG = 1.0;
export const DEFAULT_DENOISE_T2I = 1.0;
export const DEFAULT_DENOISE_I2I = 0.8;
export const DEFAULT_DENOISE_CHAIN_STAGE1 = 1.0;
export const DEFAULT_DENOISE_CHAIN_STAGE2 = 0.5;
export const DEFAULT_MP = 1.54;
// Qwen-Image 2.1 was trained on a fixed table of resolutions. At this app's
// 64px rounding, 9:16 wants ~1.56-1.60 MP.
export const QWEN21_NATIVE_MP = 1.56;
export const DEFAULT_AR = "9:16";
