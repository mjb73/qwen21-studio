/* qwen-templates.js — the Qwen-Image 2.1 prompt templates behind the "Qwen Templates" button.
 *
 * Fourteen edit prompts, one example each, written to the shape that edits reliably: the operation
 * first, only the attributes being changed named — concretely, and at full strength — then ONE
 * blanket preservation clause. Quoted text stays verbatim, nothing states a ratio or a quality
 * word, and every multi-image prompt tags its inputs <image1>, <image2>, <image3> and says what
 * each one supplies: the rewriter shipped with the model (Qwen-Image-2.1 prompt_rewrite,
 * system_prompt_edit.txt) calls those tags mandatory for two or more images and says to declare
 * each image's role — which one is the canvas and which supply material to transfer.
 *
 * Provenance of each example:
 *   [O] official Qwen material, wording kept (image notation normalised to <imageN>).
 *   [T] a published hands-on test; kept verbatim where it already edits, corrected where it
 *       under-edits or leaks.
 *   [P] built from the model's own rules — used where the published wording fails on this engine.
 *
 * The subject, scene and pose words are the example's own: replace them with yours. The shape is
 * what makes the edit land, so keep the operation first and the preservation clause last, and keep
 * the preservation clause to one sentence that names things by role rather than describing them.
 *
 * `images` is how many pictures the prompt expects, so the status line can say whether the open
 * document is even able to fill it.
 */

export const QWEN_TEMPLATES = [
  // [P] Image-driven: the pose stays in image 2, it is not described. What the published line
  // ("replace the pose of image 1 with the pose of image 2") leaves out is *what* "pose" means, so
  // the model is free to bring anything else from image 2 with it (measured: the reference's skirt
  // pattern came over). Name the attribute (limb positions, stance, torso and head angles), take
  // only that, and fence the donor with "nothing else from <image2>".
  {
    n: 1, tag: "P", title: "Pose transfer", images: 2,
    prompt: "Apply the body pose of the person in <image2> to the person in <image1>: the same limb " +
            "positions, stance, torso and head angles. Take nothing else from <image2>. Keep the " +
            "face, hair, body proportions and clothing of <image1> unchanged, and keep the " +
            "background, lighting and camera framing as they are.",
  },
  // [T] Tags normalised (the hosted example used "Image 1" prose): with two inputs the tag form is
  // mandatory, and <image1> has to be named as the canvas or the bar's scene can replace it.
  {
    n: 2, tag: "T", title: "Character into a new scene", images: 2,
    prompt: "Place the subject from <image1> sitting in the foreground seat, body turned to face " +
            "the bar shown in <image2>. Keep the subject's face, hair and clothing exactly as they " +
            "are and match the lighting of <image2>.",
  },
  // [O] Operation first and roles explicit. The outfit swap is the weakest class on this model: if
  // the dress will not transfer, mask the garment region and describe it as content instead.
  {
    n: 3, tag: "O", title: "Clothing / virtual try-on", images: 3,
    prompt: "Dress the person in <image1> in the black dress from <image2> and apply the body " +
            "pose of <image3>: the same limb positions, stance, torso and head angles. Keep her " +
            "face, hair and body proportions unchanged, and keep the background, lighting and " +
            "camera framing of <image1>.",
  },
  // [T] The published version closes by limiting the relight to the new material, which is what
  // stops a material change from re-lighting the pedestal and background with it.
  {
    n: 4, tag: "T", title: "Product material change", images: 1,
    prompt: "Change only the headphones from matte black to glossy pearl white ceramic with subtle " +
            "metallic silver accents. Preserve the exact headphone design, geometry, proportions, " +
            "ear-cup shape, headband, orientation and floating position. Keep the aluminum " +
            "pedestal, background, composition, shadows and camera angle unchanged. Update only the " +
            "reflections and highlights necessary for the new glossy material.",
  },
  // [T] Two things a bare "replace the background and lighting of image 1 with image 2" leaves out:
  // the subject has to be relit to the new source, and the donor must not bring its own content in.
  {
    n: 5, tag: "T", title: "Background and lighting swap", images: 2,
    prompt: "Replace only the background behind the subject in <image1> with the background of " +
            "<image2>. Relight the subject to match the light direction, colour temperature and " +
            "shadow softness of <image2>. Keep the subject's pose, clothing and the camera framing " +
            "unchanged.",
  },
  // [T] Naming the style image first is the published order; the preserve clause is what keeps the
  // style reference's own subject and layout out of the render.
  {
    n: 6, tag: "T", title: "Style transfer", images: 2,
    prompt: "Take the style of <image2> and apply it to <image1>. Preserve the subject, clothing " +
            "and layout of <image1>.",
  },
  {
    n: 7, tag: "T", title: "New camera viewpoint", images: 1,
    prompt: "Reconstruct the same scene from a new camera viewpoint inside the café, looking over " +
            "the barista's shoulder toward the counter. Preserve the characters' recognizable " +
            "appearance and the photorealistic documentary style, while making the new perspective " +
            "spatially coherent.",
  },
  // [T] A move needs both clauses — place it, then repair the hole — and the placement sentence is
  // what keeps the object at a believable scale in its new spot.
  {
    n: 8, tag: "T", title: "Move an object and repair the hole", images: 1,
    prompt: "Move the black dog from beside the front-left tire into the front passenger seat of the " +
            "yellow convertible. The dog should be clearly visible sitting naturally in the " +
            "passenger seat. Remove the dog completely from its original location and reconstruct " +
            "the exposed area naturally. Preserve the woman, her pose, the yellow car and all other " +
            "scene elements.",
  },
  // [T] Text is literal: quoted verbatim, typography preserved as a list, and the "no other text"
  // rule stated affirmatively (the model's own rewriter forbids prohibitions).
  {
    n: 9, tag: "T", title: "Text and typography replacement", images: 1,
    prompt: "Replace the poster title \"NEON ORBIT\" with exactly \"ECHO VECTOR\". Preserve the " +
            "artwork, composition, colours, title position, font, size, weight and overall " +
            "typography style. The new text is clearly readable and correctly spelled. No other " +
            "text appears in the image.",
  },
  {
    n: 10, tag: "T", title: "Hands and fine detail", images: 1,
    prompt: "Swap the objects held by the watchmaker's hands: place the tiny tweezers in the left " +
            "hand and the watch gear in the right hand. Keep both hands' positions, with five " +
            "anatomically correct fingers on each hand and a physically believable grip. Change " +
            "nothing else.",
  },
  {
    n: 11, tag: "O", title: "Local region edit (circle / paint / mask)", images: 1,
    prompt: "Remove the metal watch in the blue circle, change the hair in the red circle to black, " +
            "and replace the area in the green circle with gray short-sleeved linen pajamas.",
  },
  {
    n: 12, tag: "P", title: "Outpaint / new canvas", images: 1,
    prompt: "Extend the canvas to the right to include the rest of the street, continuing the road, " +
            "the building fronts and the existing light. Keep the existing subject untouched.",
  },
  {
    n: 13, tag: "O", title: "Multi-person composite", images: 2,
    prompt: "Place the two people from <image1> and <image2> into a modern Douyin (TikTok-style) " +
            "livestream studio, generating a group photo of them sitting side by side behind the " +
            "streaming desk, both facing the camera and presenting a product to the audience. " +
            "Keep the facial features, hairstyle and clothing of both people completely unchanged.",
  },
  {
    n: 14, tag: "O", title: "Transparent cutout / RGBA", images: 1,
    prompt: "This is an RGBA image with transparency. A cute cartoon dragon sticker. The image has " +
            "alpha channel and the background is transparent.",
  },
];

/**
 * Wire the templates button + its menu. Opening is a plain toggle; picking an entry hands the text
 * to `onPick` and shuts the menu again, so the list is only on screen while it is being chosen from.
 *
 * The menu is `position: fixed` and placed from the button's rect rather than absolute inside the
 * label row: the studio's panels clip their own overflow, and an absolutely positioned list would
 * be cut off at the prompt panel's edge.
 */
export function initQwenTemplates({ btn, menu, onPick, onClose }) {
  if (!btn || !menu) return { setVisible() {}, close() {}, isOpen: () => false };

  let open = false;
  let rafId = 0;
  let timers = [];
  let ro = null;

  // The list lives directly under <body>: inside the prompt panel it inherits that panel's
  // stacking context, and the sticky Generate bar (z 90) and pinned header (z 95) painted over it —
  // the last few templates were simply covered. As a body child it only has to out-rank those.
  if (menu.parentElement !== document.body) document.body.appendChild(menu);

  // The panel above the prompt changes height on its own (the gauges and the status row fill in a
  // second after load), which moves the button after the list has been placed. Re-place while it is
  // on screen: rAF for the steady state, timers for the first half second (rAF is throttled in an
  // iframe that is not being painted) and a ResizeObserver for the late layout shifts.
  function follow() {
    if (!open) return;
    place();
    rafId = requestAnimationFrame(follow);
  }

  function schedule() {
    timers = [60, 200, 500].map(ms => setTimeout(() => { if (open) place(); }, ms));
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => { if (open) place(); });
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
    }
  }

  function stopFollowing() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    timers.forEach(clearTimeout);
    timers = [];
    if (ro) { ro.disconnect(); ro = null; }
  }

  function place() {
    const r = btn.getBoundingClientRect();
    const gap = 4;
    const pad = 8;
    // Below is the natural place, but a short window (or the button near the bottom edge) has more
    // room above — and a list that hangs off the viewport cannot be picked from.
    const below = window.innerHeight - r.bottom - gap - pad;
    const above = r.top - gap - pad;
    const openUp = below < 180 && above > below;
    const space = Math.max(120, Math.min(360, openUp ? above : below));
    menu.style.maxHeight = space + "px";
    const width = Math.min(Math.max(240, r.width + 40), window.innerWidth - 2 * pad);
    menu.style.width = width + "px";
    let left = r.right - width;
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
    menu.style.left = Math.round(left) + "px";
    // Only now is the list's own height measurable: the top edge follows from it.
    const listHeight = Math.min(menu.scrollHeight, space);
    let top = openUp ? r.top - gap - listHeight : r.bottom + gap;
    top = Math.max(pad, Math.min(top, window.innerHeight - listHeight - pad));
    menu.style.top = Math.round(top) + "px";
  }

  function show() {
    open = true;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    place();
    rafId = requestAnimationFrame(follow);
    schedule();
  }

  function close() {
    if (!open) return;
    open = false;
    stopFollowing();
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (onClose) onClose();
  }

  // The list is built once: 14 fixed entries, no re-render to go stale.
  menu.innerHTML = QWEN_TEMPLATES.map(t => {
    const title = `${t.n}. ${escapeHtml(t.title)}`;
    return `<button type="button" class="tpl-item" role="option" data-n="${t.n}" ` +
           `title="${escapeHtml(t.prompt)}">${title}</button>`;
  }).join("");

  menu.addEventListener("click", ev => {
    const item = ev.target.closest && ev.target.closest(".tpl-item");
    if (!item) return;
    const tpl = QWEN_TEMPLATES.find(t => String(t.n) === item.dataset.n);
    if (!tpl) return;
    close();
    onPick(tpl);
  });

  btn.addEventListener("click", ev => {
    ev.stopPropagation();
    if (open) close();
    else show();
  });

  // Anything else on the page closes it — the list is a choice, not a mode.
  document.addEventListener("click", ev => {
    if (!open) return;
    if (menu.contains(ev.target) || btn.contains(ev.target)) return;
    close();
  });
  document.addEventListener("keydown", ev => {
    if (open && ev.key === "Escape") {
      close();
      btn.focus();
    }
  });
  // A fixed list cannot follow a scrolling panel: close instead of drifting away from the button.
  window.addEventListener("scroll", () => close(), true);
  window.addEventListener("resize", () => close());

  return {
    setVisible(on) {
      btn.hidden = !on;
      if (!on) close();
    },
    close,
    isOpen: () => open,
  };
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
