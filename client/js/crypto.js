
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBuf(b64) {
  const s = atob(b64);
  const buf = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
  return buf.buffer;
}


async function encryptPayload(publicKey, plaintext) {
  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plaintext)
  );
  const rawAes = await crypto.subtle.exportKey('raw', aesKey);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' }, publicKey, rawAes
  );
  return {
    encryptedKey: bufToB64(encryptedKey),
    iv:           bufToB64(iv),
    ciphertext:   bufToB64(cipherBuf),
  };
}

async function decryptPayload(privateKey, payload) {
  const rawAes = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    b64ToBuf(payload.encryptedKey)
  );
  const aesKey = await crypto.subtle.importKey(
    'raw', rawAes, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(payload.iv) },
    aesKey,
    b64ToBuf(payload.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}


async function signEnvelope(plaintext) {
  const data = new TextEncoder().encode(plaintext);
  const sig  = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    _signPrivKey,
    data
  );
  return bufToB64(sig);
}

async function verifyEnvelope(plaintext, signatureB64, signPubKeyB64) {
  try {
    const key = await crypto.subtle.importKey(
      'spki', b64ToBuf(signPubKeyB64),
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false, ['verify']
    );
    return await crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 32 },
      key,
      b64ToBuf(signatureB64),
      new TextEncoder().encode(plaintext)
    );
  } catch {
    return false;
  }
}



async function pubKeyToAddress(pubKeyB64) {
  const buf    = b64ToBuf(pubKeyB64);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes  = new Uint8Array(digest).slice(0, 16);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── conversation_id ─────────────────────────────────────────────────────────

async function personalConversationId(addrA, addrB) {
  const sorted = [addrA, addrB].sort().join('');
  const buf    = new TextEncoder().encode(sorted);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes  = new Uint8Array(digest).slice(0, 16);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── roster_version ───────────────────────────────────────────────────────────

async function rosterVersion(roster) {
  const sorted = [...roster].sort().join('');
  const buf    = new TextEncoder().encode(sorted);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes  = new Uint8Array(digest).slice(0, 8);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}


async function generateGroupKey() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufToB64(raw);
}

async function encryptWithGroupKey(groupKeyB64, plaintext) {
  const raw = b64ToBuf(groupKeyB64);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { iv: bufToB64(iv), ciphertext: bufToB64(cipherBuf) };
}

async function decryptWithGroupKey(groupKeyB64, payload) {
  const raw = b64ToBuf(groupKeyB64);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(payload.iv) },
    key,
    b64ToBuf(payload.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(dec));
}



const FILE_MAGIC = 'SCREWENC';

async function encryptFile(fileBytes) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, fileBytes);

  const magic   = new TextEncoder().encode(FILE_MAGIC);
  const blob    = new Uint8Array(magic.byteLength + iv.byteLength + cipher.byteLength);
  blob.set(magic, 0);
  blob.set(iv, magic.byteLength);
  blob.set(new Uint8Array(cipher), magic.byteLength + iv.byteLength);

  const rawKey = await crypto.subtle.exportKey('raw', key);
  return {
    blob:       blob.buffer,
    fileKeyB64: bufToB64(rawKey),
  };
}

async function decryptFile(blobBuffer, fileKeyB64) {
  const data  = new Uint8Array(blobBuffer);
  const magic = new TextDecoder().decode(data.slice(0, 8));
  if (magic !== FILE_MAGIC) throw new Error('Invalid file marker');

  const iv         = data.slice(8, 20);
  const ciphertext = data.slice(20);

  const rawKey = b64ToBuf(fileKeyB64);
  const key    = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  return await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

async function fileSha256(blobBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', blobBuffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── UUID v4 ─────────────────────────────────────────────────────────────────
function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}


function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Identicon ───────────────────────────────────────────────────────────────
function generateIdenticon(address, size = 32) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const hue = parseInt(address.slice(0, 4), 16) % 360;
  const fg  = `hsl(${hue}, 65%, 55%)`;

  ctx.fillStyle = '#2d2d2d';
  ctx.fillRect(0, 0, size, size);

  const cell = size / 5;
  ctx.fillStyle = fg;

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const byteIdx = row * 3 + col;
      const byte = parseInt(address.slice(byteIdx * 2, byteIdx * 2 + 2), 16);
      if (byte % 2 === 0) {
        ctx.fillRect(col * cell, row * cell, cell, cell);
        if (col < 2) ctx.fillRect((4 - col) * cell, row * cell, cell, cell);
      }
    }
  }

  return canvas.toDataURL();
}




let _markedReady = false;
function _initMarked() {
  if (_markedReady) return;
  _markedReady = true;



  const renderer = new marked.Renderer();
  renderer.link = (token) => {
    const href  = (typeof token === 'object' ? token.href  : token) || '';
    const title = (typeof token === 'object' ? token.title : null);
    const text  = (typeof token === 'object' ? token.text  : arguments[2]) || escapeHtml(href);
    const safeHref  = escapeHtml(href);
    const safeTitle = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${safeHref}"${safeTitle} target="_blank" rel="noopener noreferrer">${text}</a>`;
  };

  marked.setOptions({
    renderer,
    gfm:     true,   // GitHub Flavored Markdown: autolink, strikethrough, tables
    breaks:  true,   // \n → <br>
    pedantic: false,
  });
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {

    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  _initMarked();
  const dirty = marked.parse(text);
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b','strong','i','em','s','del','code','pre','blockquote',
                   'ul','ol','li','a','p','br','h1','h2','h3','h4','h5','h6'],
    ALLOWED_ATTR: ['href','title','target','rel'],
  });
}
