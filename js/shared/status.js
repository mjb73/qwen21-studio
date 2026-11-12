/* ================================================================
   SHARED: status.js  —  status field helpers
   ================================================================ */

export function linkStatusFields(fields) {
  const els = Array.isArray(fields) ? fields : [fields];
  return function setStatus(msg) {
    els.forEach(el => {
      if (el) el.value = msg;
    });
  };
}
