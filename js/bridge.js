/* ================================================================
   bridge.js  —  Inter-app postMessage bridge (v1), generator side.

   The generator already RECEIVED prompts ({type:"setPrompt"} from the
   split wrapper) but never replied, so the assistant's "Sent" button
   was a two-second timer with no idea whether anything arrived.

   This module adds the return path. Both directions carry a `pid`
   (prompt id) so the assistant can match a reply to the exact card.

     Receives  {type:"bridge", subtype:"ping",      ver:"v1"}
               {type:"bridge", subtype:"setPrompt", ver:"v1", prompt, pid}
     Sends     {type:"bridge", subtype:"pong",      ver:"v1", ok:true}
               {type:"bridge", subtype:"receipt",   ver:"v1", pid, ok}
               {type:"bridge", subtype:"render",    ver:"v1", pid, filename, url, stage}
   ================================================================ */

const BRIDGE_VERSION = "v1";

let _debug = false;
try {
  _debug = location.search.includes("bridge-debug=1");
} catch (_e) {}

function _log(...args) {
  if (_debug) console.log("[bridge]", ...args);
}

function _toParent(payload) {
  try {
    window.parent.postMessage(
      { type: "bridge", ver: BRIDGE_VERSION, ...payload },
      "*"
    );
    _log("sent", payload.subtype, payload.pid || "");
    return true;
  } catch (err) {
    _log("send failed", err);
    return false;
  }
}

// The pid of the most recent prompt received, so a generation that finishes
// later can be attributed to the card that sent it.
let _currentPid = null;

export function getCurrentPid() {
  return _currentPid;
}

/**
 * Confirm that a prompt arrived and was accepted into the composer.
 * This is the message the assistant uses to replace its optimistic
 * two-second "Sent" flash with a real acknowledgement.
 */
export function sendReceipt(pid) {
  return _toParent({ subtype: "receipt", pid: pid || _currentPid, ok: true });
}

/**
 * Report a finished image back to the assistant.
 * @param {object} opts
 * @param {string} opts.filename  file the generator saved
 * @param {string} [opts.url]     previewable image_url, when available
 * @param {number} [opts.stage]   1 for a chain render, 2 (or omitted) for final
 * @param {string} [opts.pid]     overrides the current pid
 */
export function sendRender(opts = {}) {
  const payload = {
    subtype: "render",
    pid: opts.pid || _currentPid,
    ok: opts.ok !== false,
    filename: opts.filename || "",
    url: opts.url || "",
    stage: opts.stage || 2,
  };
  if (opts.error) payload.error = String(opts.error);
  // Only clear the correlation once the FINAL image is reported; a chain
  // render at stage 1 still needs the pid when stage 2 lands.
  if (payload.stage === 2) _currentPid = null;
  return _toParent(payload);
}

/**
 * Wire the listener. `onPrompt(prompt, pid)` is called for each inbound
 * prompt; return value is ignored.
 */
export function initBridge(onPrompt) {
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.type !== "bridge") return;

    if (d.subtype === "ping") {
      _log("got ping, replying pong");
      // Reply to the sender (the wrapper), which relays it onward.
      try {
        (e.source || window.parent).postMessage(
          { type: "bridge", subtype: "pong", ver: BRIDGE_VERSION, ok: true },
          e.origin || "*"
        );
      } catch (err) {
        _log("pong failed", err);
      }
      return;
    }

    if (d.subtype === "setPrompt" && typeof d.prompt === "string") {
      _currentPid = d.pid || null;
      _log("got prompt", _currentPid, d.prompt.slice(0, 40) + "...");
      if (typeof onPrompt === "function") onPrompt(d.prompt, _currentPid);
      sendReceipt(_currentPid);
    }
  });

  _log("listening (add ?bridge-debug=1 to this URL to trace)");
}
