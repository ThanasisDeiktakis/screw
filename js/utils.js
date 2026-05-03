


/**
 * 
 * 
 * 
 * 
 */
function sanitizeName(raw) {
  if (!raw) return '';
  const el = document.createElement('div');
  el.textContent = String(raw).slice(0, 64);
  return el.innerHTML;
}

/**
 * 
 * 
 */
function validateAddress(raw) {
  if (!raw) return null;
  const addr = String(raw).toLowerCase().replace(/[^0-9a-f]/g, '');
  return addr.length === 32 ? addr : null;
}

/**
 * 
 * 
 * 
 */
function validateMessageId(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (s.length > 64) return null;
  return /^[a-zA-Z0-9\-]+$/.test(s) ? s : null;
}

/**
 * 
 * 
 */
function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}

