/* ================================================================
   SHARED: api.js  —  thin fetch wrappers with timeout + abort
   ================================================================ */

const DEFAULT_TIMEOUT = 30000;

function _fetchJSON(url, options = {}) {
  const controller = new AbortController();
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal })
    .then(r => {
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(err => {
      clearTimeout(timer);
      throw err;
    });
}

export function get(url, opts) {
  return _fetchJSON(url, { method: 'GET', ...opts });
}

export function post(url, body, opts) {
  return _fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...opts,
  });
}

export function postForm(url, formData, opts) {
  const controller = new AbortController();
  const timeout = opts?.timeout || DEFAULT_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { method: 'POST', body: formData, signal: controller.signal, ...opts })
    .then(r => {
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(err => {
      clearTimeout(timer);
      throw err;
    });
}

export function getSSE(url, onMessage, onError, onOpen) {
  const source = new EventSource(url);
  if (onOpen) source.onopen = () => onOpen(source);
  source.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data), source);
    } catch (err) {
      // ignore parse errors on partial chunks
    }
  };
  source.onerror = (e) => {
    if (onError) onError(e, source);
    source.close();
  };
  return source;
}
