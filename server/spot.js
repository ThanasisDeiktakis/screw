'use strict';
// 1. Loadenv
const { loadOrCreate } = require('./src/spot/env');
loadOrCreate();
const http = require('http');
const express = require('express');
const { authMiddleware } = require('./src/spot/middleware');
const { register: authRegister, verify: authVerify } = require('./src/spot/auth');
const { send } = require('./src/spot/send');
const { receive } = require('./src/spot/receive');
const { list: contactsList, upsert: contactsUpsert, remove: contactsRemove } = require('./src/spot/contacts');
const { init: wsInit } = require('./src/spot/ws');
const { initPush, getVapidPublic, subscribe: pushSubscribe } = require('./src/spot/push');
const { initS3, requestUpload, isConfigured: s3Configured, getMaxSize, getTtlDays } = require('./src/spot/files');
const PORT = process.env.PORT || 8080;
const app = express();
app.use(express.json({ limit: '1mb' }));
// InitializeWeb Push
initPush();
// InitializeS3
initS3();
// Logging
app.use((req, res, next) => {
  if (req.path !== '/health') {
    console.log(`[http] ${req.method} ${req.path}`);
  }
  next();
});


app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/auth/register', authRegister);
app.post('/auth/verify', authVerify);

app.get('/push/vapid-public', getVapidPublic);
// --- Server config
app.get('/config', (req, res) => {
  res.json({
    push_enabled:    !!process.env.VAPID_PUBLIC,
    vapid_public:    process.env.VAPID_PUBLIC || null,
    files_enabled:   s3Configured(),
    files_max_size:  s3Configured() ? getMaxSize() : null,
    files_ttl_days:  s3Configured() ? getTtlDays() : null,
  });
});
// --- Protected routes
app.post('/send', authMiddleware, send);
app.get('/receive', authMiddleware, receive);
app.post('/push/subscribe', authMiddleware, pushSubscribe);
app.get('/contacts', authMiddleware, contactsList);
app.put('/contacts/:hash', authMiddleware, contactsUpsert);
app.delete('/contacts/:hash', authMiddleware, contactsRemove);
// --- FilesS3) ---
app.post('/files/upload', authMiddleware, requestUpload);
// Health check
app.get('/health', (req, res) => res.json({ ok: true }));
// Client static filesDISABLE_STATIC=1 .env)
if (!process.env.DISABLE_STATIC || process.env.DISABLE_STATIC === '0') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, '..', 'client')));
  console.log('[spot] client static enabled');
} else {
  console.log('[spot] client static disabled (DISABLE_STATIC=1)');
}
// --- HTTP + WebSocket ---
const server = http.createServer(app);
wsInit(server);
server.listen(PORT, () => {
  console.log(`[spot] running on http://localhost:${PORT}`);
});

