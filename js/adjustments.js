/* adjustments.js — the Post-processing section.
 *
 * Two finishing moves that act on the picture open in PhotoCraft rather than on the render:
 * a Vibrance and a Curves adjustment layer, added above the layer that is active there. Neither
 * takes a parameter — the values are the ones the user's own finishing layers carry, and they live
 * on the panel's side (services.py ADJUSTMENT_DEFAULTS), not here: this module only asks.
 *
 * The panel owns the bridge to PhotoCraft, so everything goes over postMessage, the same
 * request/reply shape generate.js uses for "give me the picture open in PhotoCraft":
 *
 *   ask     {type:"photocraft-ai-postprocess", id, action:"add"|"enable"|"disable"|"state", kind}
 *   reply   {type:"photocraft-ai-postprocess", id, ok?, message?, kinds?, error?}
 *
 * The checkbox is a switch, not a duplicate of the button: it reflects whether the document
 * currently has a visible layer of that kind, ticking it adds one when there is none and shows the
 * hidden ones otherwise, and unticking hides them (they stay in the stack — nothing is deleted).
 */

import { showToast } from "./ui.js?v=x54";

const LABEL = { vibrance: "Vibrance", curves: "Curves" };
const TIMEOUT_MS = 45000;

const el = (id) => document.getElementById(id);

let busy = false;

/* ── The message round trip ─────────────────────────────────────────────────────────────────── */
function ask(payload, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error("Open this in the PhotoCraft AI panel — there is no editor to adjust from here."));
      return;
    }
    const id = "pp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    let timer = null;
    const finish = (fn, arg) => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      fn(arg);
    };
    function onMessage(ev) {
      const d = ev.data;
      if (!d || d.type !== "photocraft-ai-postprocess" || d.id !== id) return;
      if (d.error) finish(reject, new Error(d.error));
      else finish(resolve, d);
    }
    timer = setTimeout(
      () => finish(reject, new Error("PhotoCraft did not answer in time — bring its window forward and try again.")),
      timeoutMs);
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "photocraft-ai-postprocess", id, ...payload }, "*");
  });
}

/* ── Painting ─────────────────────────────────────────────────────────────────────────────── */
// The boxes are the standing choice (what happens to the NEXT picture), the header describes the
// picture that is open now — the two are allowed to disagree: a fresh render arrives untouched for
// a moment, and an older document can carry layers the boxes no longer ask for.
function paint(res) {
  res = res || {};
  const kinds = res.kinds || {};
  const prefs = res.prefs || {};
  for (const kind of Object.keys(LABEL)) {
    const box = el("adjust" + LABEL[kind] + "On");
    if (box) box.checked = !!prefs[kind];
  }
  const on = Object.keys(LABEL).filter((k) => (kinds[k] || {}).visible).map((k) => LABEL[k]);
  const summary = el("postAdjustSummary");
  if (summary) summary.textContent = on.length ? on.join(" · ") : "off";
}

async function refresh(retries = 1) {
  try {
    const res = await ask({ action: "state" });
    paint(res);
    return res;
  } catch (e) {
    // One quiet retry: the usual failure is a document being switched in PhotoCraft right then
    // (a render landing), which clears by itself a few seconds later.
    if (retries > 0) { setTimeout(() => refresh(retries - 1), 5000); return null; }
    // No editor open, or the engine is running on its own: never claim "off" when the answer is
    // actually unknown — say nothing at all.
    const summary = el("postAdjustSummary");
    if (summary) summary.textContent = "—";
    return null;
  }
}

/* ── Actions ───────────────────────────────────────────────────────────────────────────────── */
function setBusy(on) {
  busy = on;
  ["adjustVibranceBtn", "adjustCurvesBtn"].forEach((id) => {
    const b = el(id);
    if (b) { b.disabled = on; b.classList.toggle("busy", on); }
  });
  ["adjustVibranceOn", "adjustCurvesOn"].forEach((id) => {
    const c = el(id);
    if (c) c.disabled = on;
  });
}

async function act(payload) {
  if (busy) return;
  setBusy(true);
  try {
    const res = await ask(payload);
    if (res.message) showToast(res.message, "success");
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    await refresh();
    setBusy(false);
  }
}

/* ── Wiring ────────────────────────────────────────────────────────────────────────────────── */
export function initAdjustments() {
  const section = el("postAdjustPanel");
  const toggle = el("postAdjustToggle");
  if (!section || !toggle) return;

  toggle.addEventListener("click", () => {
    const collapsed = !section.classList.contains("collapsed");
    section.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    // Opening it is the moment the answer matters: read the document then, not on load, so the
    // boxes are right even if the picture was changed in PhotoCraft meanwhile.
    if (!collapsed) refresh();
  });

  for (const kind of Object.keys(LABEL)) {
    const btn = el("adjust" + LABEL[kind] + "Btn");
    const box = el("adjust" + LABEL[kind] + "On");
    if (btn) btn.addEventListener("click", () => act({ action: "add", kind }));
    if (box) {
      box.addEventListener("change", () => {
        // Toggle: remembers the choice for every picture that arrives next AND applies it to the
        // one open now, so the tick never lies about what the user is looking at.
        act({ action: "toggle", kind, enabled: box.checked });
      });
    }
  }

  // The panel says when a render has landed (the ticked adjustments come with it), so the header
  // keeps up without waiting for the section to be opened.
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.type !== "photocraft-ai-delivered") return;
    refresh();
  });

  // One read at load so the folded header is not lying: it says what the picture already carries,
  // not "off" until someone opens it. Failure is silent — the section is only useful beside the panel.
  refresh();
}
