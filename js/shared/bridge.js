/* ================================================================
   SHARED: bridge.js  —  Inter-app postMessage bridge (v1)

   Protocol:
     Sender   —  {type: "bridge", subtype: "ping", ver: "v1"}
     Receiver —  {type: "bridge", subtype: "pong", ver: "v1", ok: true}
     Data     —  {type: "bridge", subtype: "setPrompt", ver: "v1", prompt: "..."}
   ================================================================ */

const BRIDGE_VERSION = "v1";
let _ready = false;
let _pending = [];
let _debug = false;

try {
  _debug = location.search.includes("bridge-debug=1");
} catch (_e) {}

function _log(...args) {
  if (_debug) console.log("[bridge]", ...args);
}

export function isReady() {
  return _ready;
}

let _handlers = {};

export function on(type, fn) {
  if (!_handlers[type]) _handlers[type] = [];
  _handlers[type].push(fn);
}

function _emit(type, payload) {
  const fns = _handlers[type] || [];
  fns.forEach((f) => f(payload));
}

export function initBridge() {
  _ready = false;

  window.addEventListener("message", (e) => {
    if (!e.data || e.data.type !== "bridge") return;
    const subtype = e.data.subtype;
    if (subtype === "pong") {
      _log("got pong");
      _ready = true;
      _flush();
      return;
    }
    if (subtype === "ping") {
      _log("got ping, sending pong");
      e.source.postMessage(
        { type: "bridge", subtype: "pong", ver: BRIDGE_VERSION, ok: true },
        e.origin || "*"
      );
      _ready = true;
      return;
    }
    if (subtype === "setPrompt" && typeof e.data.prompt === "string") {
      _log("got prompt", e.data.prompt.slice(0, 40) + "...");
      _emit("prompt", e.data);
    }
  });

  const ping = () => {
    _log("sending ping");
    window.parent.postMessage(
      { type: "bridge", subtype: "ping", ver: BRIDGE_VERSION },
      "*"
    );
  };
  // Ping immediately, and again every 3 seconds
  ping();
  const timer = setInterval(ping, 3000);

  // Stop after a while if nobody answers
  setTimeout(() => clearInterval(timer), 30000);
}

function _flush() {
  if (!_ready) return;
  while (_pending.length) {
    const payload = _pending.shift();
    _log("flushing", payload.subtype, payload.prompt?.slice(0, 40) + "..." || "");
    window.parent.postMessage(
      { type: "bridge", ...payload, ver: BRIDGE_VERSION },
      "*"
    );
  }
}

export function sendPrompt(prompt) {
  if (!prompt) return;
  const payload = { subtype: "setPrompt", prompt };
  if (!_ready) {
    _pending.push(payload);
    _log("queued prompt");
  } else {
    _log("sending prompt");
    window.parent.postMessage(
      { type: "bridge", ...payload, ver: BRIDGE_VERSION },
      "*"
    );
  }
}

export function send(type, payload) {
  window.parent.postMessage(
    { type: "bridge", subtype: type, ...payload, ver: BRIDGE_VERSION },
    "*"
  );
}
