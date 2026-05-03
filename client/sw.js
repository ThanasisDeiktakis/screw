'use strict';

const CACHE_NAME = 'screw-v32';

// Files to precache on SW install
// ⚠️ IMPORTANT: when adding new JS/CSS/HTML files —
// add them here, otherwise SW won't activate
// (cache.addAll() will fail on 404 and app won't install).
const PRECACHE = [
  './',
  './index.html',
  './add.html',
  './config.js',
  './favicon.ico',
  './css/base.css',
  './css/layout.css',
  './css/messages.css',
  './css/modals.css',
  './css/mobile.css',
  './css/add.css',
  './css/karta.css',
  './manifest.json',
  './js/i18n.js',
  './js/utils.js',
  './js/app.js',
  './js/logger.js',
  './js/storage.js',
  './js/crypto.js',
  './js/identity.js',
  './js/messages.js',
  './js/contacts.js',
  './js/groups.js',
  './js/ui.js',
  './js/marked.min.js',
  './js/purify.min.js',
  './js/qrcode.min.js',
  './js/karta.js',
  './locales/ru.js',
  './locales/el.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './screenshots/desktop.png',
  './screenshots/mobile.png',
];

// ─── Messages from page ────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── Install: precache static assets ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: remove old caches ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== 'screw-sw-state').map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: network first, cache fallback ───────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  const isApi = ['/send', '/receive', '/auth/', '/contacts', '/ws', '/health', '/push/']
    .some(p => url.pathname.startsWith(p));

  if (isApi) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ─── Push notifications ────────────────────────────────────────────────────────

// SW log — write to Cache API, the only storage available in SW.
// Read from tab: caches.open('screw-sw-state').then(c=>c.match('/sw-log')).then(r=>r?.text()).then(console.log)
async function _swLog(text) {
  try {
    const cache = await caches.open('screw-sw-state');
    const existing = await cache.match('/sw-log').then(r => r ? r.text() : '').catch(() => '');
    const ts = new Date().toISOString().slice(11, 23);
    const updated = (existing + `\n[${ts}] ${text}`).split('\n').slice(-50).join('\n');
    await cache.put('/sw-log', new Response(updated));
  } catch {}
}

self.addEventListener('push', event => {
  let data = {};
  let parseError = null;
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    parseError = e.message;
  }

  const msgId = data.message_id || null;
  const tag   = msgId ? `screw-msg-${msgId}` : 'screw-message';
  const title = data.title || 'Screw';
  const body  = data.body  || '💬 New message';
  const icon  = data.icon  || '/icons/icon-192.png';
  const badge = data.badge || '/icons/icon-72.png';

  event.waitUntil(
    _swLog(`push: msgId=${msgId} parseErr=${parseError} hasData=${!!event.data}`)
      .then(() => self.registration.showNotification(title, {
        body, icon, badge, tag,
        renotify: true,
        data: { message_id: msgId },
      }))
      .then(() => _swLog('notification shown'))
      // Generic shown — now wake the tab, it will replace notification with decrypted
      .then(() => clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(list => {
        list.forEach(c => c.postMessage({ type: 'PUSH_RECEIVED', message_id: msgId }));
      })
      .catch(e => _swLog(`ERROR: ${e.message}`))
  );
});

// ─── Notification click — open/focus tab ──────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const msgId     = event.notification.data && event.notification.data.message_id;
  const base      = self.registration.scope;
  const targetUrl = msgId ? `${base}?msg=${encodeURIComponent(msgId)}` : base;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.startsWith(base));
      if (existing) {
        existing.postMessage({ type: 'OPEN_MESSAGE', message_id: msgId });
        return existing.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
