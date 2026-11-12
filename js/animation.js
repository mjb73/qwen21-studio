/* animation.js — generating animation overlay (canvas particles, scanlines, grid) */

import * as state from "./state-v2.js?v=x54";
import { getThemeColor, rgbaFromVar } from "./color.js?v=x54";

let animFrameId = null;
let animCtx = null;

export function setOutputMode(mode) {
  // mode: 'animation' | 'stage1' | 'final' | 'placeholder'
  if (state.outputImage) {
    state.outputImage.style.display = mode === 'final' ? 'block' : 'none';
    if (mode !== 'final') {
      state.outputImage.src = '';
      state.outputImage.style.filter = 'none';
    }
  }
  if (state.stage1OutputBlock) {
    state.stage1OutputBlock.style.display = mode === 'stage1' ? 'block' : 'none';
    if (mode !== 'stage1' && state.stage1OutputImage) state.stage1OutputImage.src = '';
  }
  if (state.generatingCanvas) {
    state.generatingCanvas.style.display = mode === 'animation' ? 'block' : 'none';
  }
  if (state.outputPlaceholder) {
    state.outputPlaceholder.style.display = mode === 'placeholder' ? 'block' : 'none';
  }
  if (state.outputGlassPanel) {
    if (mode === 'animation') {
      state.outputGlassPanel.style.border = 'none';
      state.outputGlassPanel.style.background = 'transparent';
      state.outputGlassPanel.style.padding = '0';
    } else {
      state.outputGlassPanel.style.border = '';
      state.outputGlassPanel.style.background = '';
      state.outputGlassPanel.style.padding = '';
    }
  }
  if (state.outputSectionHeader) {
    state.outputSectionHeader.style.display = mode === 'animation' ? 'none' : '';
  }
  if (state.outputWrap) {
    if (mode === 'animation') {
      state.outputWrap.style.border = 'none';
      state.outputWrap.style.background = 'transparent';
      state.outputWrap.style.padding = '0';
    } else {
      state.outputWrap.style.border = '';
      state.outputWrap.style.background = '';
      state.outputWrap.style.padding = '';
    }
  }
  // Clear vignette overlay when image is not visible
  if (state.outputVignetteCanvas && mode !== 'final') {
    state.outputVignetteCanvas.style.display = 'none';
    const ctx = state.outputVignetteCanvas.getContext('2d');
    ctx.clearRect(0, 0, state.outputVignetteCanvas.width, state.outputVignetteCanvas.height);
  }
  // Show post-process panel when there is an image to edit
  if (state.postProcessPanel) {
    const showPP = (mode === 'final' || mode === 'stage1');
    state.postProcessPanel.style.display = showPP ? 'block' : 'none';
    if (showPP) state.postProcessPanel.classList.add('active');
    else state.postProcessPanel.classList.remove('active');
  }
}

export function startGeneratingAnimation() {
  if (!state.generatingCanvas) return;
  setOutputMode('animation');
  const canvas = state.generatingCanvas;
  canvas.width = canvas.clientWidth || 640;
  canvas.height = canvas.clientHeight || (canvas.width * 16 / 9);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  animCtx = ctx;
  const w = canvas.width;
  const h = canvas.height;

  const cols = 30;
  const rows = 50;
  const particles = [];
  const maxParticles = 80;

  const accent = getThemeColor("--accent", "#8df574");
  const accentHover = getThemeColor("--accent-hover", "#76e9ff");
  const pink = getThemeColor("--pink", "#f36edc");
  const colors = [accent, accentHover, pink];
  const fontDisplay = getComputedStyle(document.body).getPropertyValue("--font-display").trim() || '"Chakra Petch", sans-serif';
  const fontMono = getComputedStyle(document.body).getPropertyValue("--font-mono").trim() || '"IBM Plex Mono", monospace';

  for (let i = 0; i < maxParticles; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 3.5,
      vy: (Math.random() - 0.5) * 3.5,
      size: Math.random() * 8 + 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: Math.random() * 0.5 + 0.2,
    });
  }

  let scanY = 0;
  let time = 0;

  function draw() {
    if (!state.generatingCanvas || state.generatingCanvas.style.display === "none") return;
    time += 0.016;
    const speedMult = 1 + Math.min(time / 12, 5);
    ctx.fillStyle = rgbaFromVar("--bg-0", 0.25, "#080c14");
    ctx.fillRect(0, 0, w, h);

    const gridColor = rgbaFromVar("--accent-hover", 0.08, "#76e9ff");
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    const cx = w / 2;
    const cy = h * 0.55;
    const horizon = h * 0.35;

    for (let i = -cols / 2; i <= cols / 2; i++) {
      const xBase = cx + i * (w / cols);
      const xTop = cx + i * (w / cols) * 0.1;
      ctx.beginPath();
      ctx.moveTo(xBase, h);
      ctx.lineTo(xTop, horizon);
      ctx.stroke();
    }

    for (let i = 0; i < rows; i++) {
      const t = i / rows;
      const y = horizon + (h - horizon) * (t * t);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    scanY = (scanY + 2 * speedMult) % h;
    ctx.fillStyle = rgbaFromVar("--accent", 0.06, "#8df574");
    ctx.fillRect(0, scanY, w, 2 + Math.sin(time * 3 * speedMult) * 1);

    if (Math.random() > 0.92) {
      const gw = Math.random() * w * 0.15;
      const gh = Math.random() * 4 + 1;
      const gx = Math.random() * (w - gw);
      const gy = Math.random() * (h - gh);
      ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)] + "40";
      ctx.fillRect(gx, gy, gw, gh);
    }

    for (const p of particles) {
      p.x += p.vx * speedMult;
      p.y += p.vy * speedMult;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      ctx.globalAlpha = p.alpha + Math.sin(time * 2 * speedMult + p.x) * 0.1;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 44px ${fontDisplay}`;
    const glowAlpha = 0.5 + Math.sin(time * 2 * speedMult) * 0.2;
    ctx.fillStyle = rgbaFromVar("--accent", glowAlpha, "#8df574");
    ctx.shadowColor = accent;
    ctx.shadowBlur = 32 + Math.sin(time * 3 * speedMult) * 16;
    ctx.fillText("GENERATING", cx, cy - 28);
    ctx.font = `400 28px ${fontMono}`;
    ctx.fillStyle = rgbaFromVar("--accent-hover", glowAlpha * 0.8, "#76e9ff");
    ctx.shadowColor = accentHover;
    ctx.shadowBlur = 20;
    const dots = ".".repeat(Math.floor((time * 3 * speedMult) % 4));
    ctx.fillText(`Processing${dots}`, cx, cy + 36);
    ctx.restore();

    animFrameId = requestAnimationFrame(draw);
  }

  draw();
}

export function stopGeneratingAnimation() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  const hasImage = state.outputImage && state.outputImage.style.display === 'block';
  const hasStage1 = state.stage1OutputBlock && state.stage1OutputBlock.style.display === 'block';
  if (!hasImage && !hasStage1) {
    setOutputMode('placeholder');
  }
}
