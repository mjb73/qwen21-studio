/* ================================================================
   SHARED: toast.js  —  notification system
   ================================================================ */

let toastEl = null;
let toastTimeout = null;

export function setToastElement(el) {
  toastEl = el;
}

export function showToast(message, type = 'info') {
  if (!toastEl) {
    console.warn('[toast] No element set — call setToastElement first');
    return;
  }
  if (toastTimeout) clearTimeout(toastTimeout);
  toastEl.textContent = message;
  toastEl.className = 'toast ' + type;
  toastTimeout = setTimeout(() => {
    toastEl.classList.add('hidden');
    toastTimeout = null;
  }, 3000);
}
