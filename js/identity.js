// ─── Initialize───────────────────────────────────────────

async function initIdentity() {
  const db = await openDB();

  let pubKeyObj   = await dbGet(db, 'publicKey');
  let privKeyObj  = await dbGet(db, 'privateKey');
  let signPubObj  = await dbGet(db, 'signPublicKey');
  let signPrivObj = await dbGet(db, 'signPrivateKey');
  let isNew       = false;

  if (!pubKeyObj || !privKeyObj) {
    isNew = true;
    const kp = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']
    );
    pubKeyObj  = kp.publicKey;
    privKeyObj = kp.privateKey;
    await dbPut(db, 'publicKey',  pubKeyObj);
    await dbPut(db, 'privateKey', privKeyObj);
  }

  if (!signPubObj || !signPrivObj) {
    const kp2 = await crypto.subtle.generateKey(
      { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify']
    );
    signPubObj  = kp2.publicKey;
    signPrivObj = kp2.privateKey;
    await dbPut(db, 'signPublicKey',  signPubObj);
    await dbPut(db, 'signPrivateKey', signPrivObj);
  }

  _publicKey   = pubKeyObj;
  _privateKey  = privKeyObj;
  _signPubKey  = signPubObj;
  _signPrivKey = signPrivObj;

  const exportedSpki = await crypto.subtle.exportKey('spki', pubKeyObj);
  _address = await pubKeyToAddress(bufToB64(exportedSpki));


  _deviceId = localStorage.getItem('screw-device-id');
  if (!_deviceId) {
    _deviceId = uuidv4();
    localStorage.setItem('screw-device-id', _deviceId);
  }

  // RestorelocalStorage
  _authToken = localStorage.getItem('screw-auth-token') || null;

  return isNew;
}



async function registerDevice() {
  const encPubB64  = bufToB64(await crypto.subtle.exportKey('spki', _publicKey));
  const signPubB64 = bufToB64(await crypto.subtle.exportKey('spki', _signPubKey));


  const regRes = await fetch(`${SERVER_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: _deviceId, enc_pub_key: encPubB64, sign_pub_key: signPubB64 }),
  });
  if (!regRes.ok) throw new Error(`register failed: ${regRes.status}`);
  const { challenge } = await regRes.json();


  const sigBuf = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    _signPrivKey,
    new TextEncoder().encode(challenge)
  );
  const signature = bufToB64(sigBuf);


  const verRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: _deviceId, challenge, signature }),
  });
  if (!verRes.ok) throw new Error(`verify failed: ${verRes.status}`);
  const { token } = await verRes.json();

  _authToken = token;
  localStorage.setItem('screw-auth-token', token);
  console.log('[auth] device authorized');
  notifySwAuth();
}


function notifySwAuth() {
  if (!_authToken || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    reg.active && reg.active.postMessage({
      type: 'SET_AUTH',
      token: _authToken,
      serverUrl: SERVER_URL,
    });
  });
}


async function authedFetch(url, options = {}) {

  if (!_authToken) await registerDevice();

  const doFetch = (token) => fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'Authorization': `Bearer ${token}`,
    },
  });

  let res = await doFetch(_authToken);

  if (res.status === 401) {

    console.log('[auth] 401, refreshing token…');
    await registerDevice();
    res = await doFetch(_authToken);
  }

  return res;
}


function connectWs() {

  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  // Close
  if (_ws) { try { _ws.close(); } catch {} _ws = null; }
  if (!_authToken) return;

  const wsUrl = SERVER_URL.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(_authToken)}`;
  _ws = new WebSocket(wsUrl);

  _ws.onopen = () => {
    console.log('[ws] connected');
    if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }
  };

  _ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleIncomingMessage(msg);
    } catch (e) {
      console.warn('[ws] parse error:', e);
    }
  };

  _ws.onclose = (e) => {
    console.log('[ws] closed, code:', e.code);
    _ws = null;
    if (e.code === 4401) {

      registerDevice().then(connectWs).catch(console.error);
    } else {

      _wsReconnectTimer = setTimeout(connectWs, 5000);
    }
  };

  _ws.onerror = () => { /* onclose will fire next */ };
}



// ConvertVAPID public key base64url Uint8Array
function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}


async function _getSwRegistration() {
  if (!('serviceWorker' in navigator)) throw new Error('sw-not-supported');





  let reg = window._swRegistrationPromise
    ? await window._swRegistrationPromise
    : null;

  if (!reg) throw new Error('sw-not-ready');


  if (reg.active) return reg;


  const pending = reg.installing || reg.waiting;
  if (pending) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sw-activate-timeout')), 10000);
      const check = () => {
        if (reg.active) { clearTimeout(timer); resolve(); }
      };
      pending.addEventListener('statechange', () => {
        if (pending.state === 'activated' || pending.state === 'redundant') {
          clearTimeout(timer);
          if (reg.active) resolve();
          else reject(new Error('sw-not-ready'));
        }
      });

      check();
    });
    if (reg.active) return reg;
  }

  throw new Error('sw-not-ready');
}


async function subscribeToPush() {
  if (!('PushManager' in window)) {
    console.log('[push] PushManager not supported');
    return;
  }

  const reg = await _getSwRegistration();

  // Check?
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {

    let vapidKeyStr = window.serverConfig?.vapid_public;
    if (!vapidKeyStr) {
      const r = await fetch(`${SERVER_URL}/push/vapid-public`);
      if (!r.ok) throw new Error('vapid-key-failed');
      vapidKeyStr = (await r.json()).key;
    }
    const vapidKey = _urlBase64ToUint8Array(vapidKeyStr);

    // Create
    try {
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey });
      console.log('[push] subscription created');
    } catch (e) {
      console.warn('[push] subscribe error:', e.message);
      const isBrave = !!(navigator.brave);
      if (isBrave || e.message?.toLowerCase().includes('push service') || e.name === 'AbortError') {
        throw new Error('brave-no-gcm');
      }
      throw e;
    }
  }



  const sub = subscription.toJSON();
  await authedFetch(`${SERVER_URL}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }),
  });
  console.log('[push] subscription synced with server');
}


// Called
async function enablePushNotifications() {
  if (!('Notification' in window) || !('PushManager' in window)) {
    updatePushStatus(t('push.browserNotSupported','❌ Browser does not support push'), '#f44747');
    return;
  }
  if (Notification.permission === 'denied') {
    updatePushStatus(t('push.browserBlocked','❌ Notifications blocked. Allow in browser settings.'), '#f44747');
    return;
  }
  updatePushStatus(t('push.requesting','⏳ Requesting permission…'), '#888');
  const perm = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (perm !== 'granted') {
    updatePushStatus(t('push.denied','❌ Permission denied'), '#f44747');
    return;
  }
  updatePushStatus(t('push.subscribing','⏳ Subscribing…'), '#888');
  try {
    await subscribeToPush();
    updatePushStatus(t('push.success','✅ Push notifications enabled'), '#4ec9b0');
    const btn = document.getElementById('btn-push-subscribe');
    if (btn) btn.textContent = t('push.enabled','🔔 Notifications enabled');
  } catch (e) {
    if (e.message === 'brave-no-gcm') {
      updatePushStatus(
        t('push.braveHint','⚠️ Brave blocks push. Enable: brave://settings/privacy → ') +
        '"Use Google Services for push messaging".',
        '#ce9178'
      );
    } else if (e.message === 'sw-not-ready' || e.message === 'sw-not-supported' || e.message === 'sw-activate-timeout') {
      updatePushStatus(
        t('push.swNotActive','❌ Service worker not active. Reload page.'),
        '#f44747'
      );
    } else if (e.message === 'vapid-key-failed') {
      updatePushStatus(t('push.serverKeyError','❌ Could not get server key.'), '#f44747');
    } else {
      updatePushStatus(t('push.error','❌ Error: ') + e.message, '#f44747');
    }
  }
}

function updatePushStatus(text, color) {
  const el = document.getElementById('push-status');
  if (el) { el.textContent = text; el.style.color = color || '#888'; }
}


async function refreshPushButton() {
  const btn = document.getElementById('btn-push-subscribe');
  const status = document.getElementById('push-status');
  if (!btn || !status) return;
  if (!('Notification' in window) || !('PushManager' in window)) {
    btn.textContent = t('push.notSupported','🔕 Push not supported');
    btn.disabled = true;
    return;
  }
  if (Notification.permission === 'denied') {
    btn.textContent = t('push.blocked','🔕 Notifications blocked');
    status.textContent = t('push.blockedHint','Allow notifications in browser settings.');
    status.style.color = '#f44747';
    btn.disabled = true;
    return;
  }
  if (Notification.permission !== 'granted') {
    btn.textContent = t('push.enable','🔔 Enable push notifications');
    status.textContent = '';
    btn.disabled = false;
    return;
  }

  try {
    let reg = window._swRegistrationPromise
      ? await window._swRegistrationPromise
      : null;
    if (!reg) {
      const regs = await navigator.serviceWorker.getRegistrations();
      reg = regs[0] || null;
    }
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      btn.textContent = t('push.enabled','🔔 Notifications enabled');
      status.textContent = t('push.active','Subscription active. Click to resubscribe.');
      status.style.color = '#4ec9b0';
    } else {
      btn.textContent = t('push.enable','🔔 Enable push notifications');
      status.textContent = t('push.notActive','⚠️ Permission granted but not subscribed. Click to subscribe.');
      status.style.color = '#ce9178';
    }
  } catch {
    btn.textContent = t('push.enable','🔔 Enable push notifications');
    status.textContent = '';
  }
  btn.disabled = false;
}

