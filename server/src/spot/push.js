'use strict';

const webPush = require('web-push');
const { getDb } = require('./db');


function initPush() {
  if (!process.env.VAPID_PUBLIC || !process.env.VAPID_PRIVATE) {
    console.warn('[push] VAPID keys not found, push disabled');
    return;
  }
  webPush.setVapidDetails(
    process.env.VAPID_CONTACT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC,
    process.env.VAPID_PRIVATE
  );
  console.log('[push] web-push initialized');
}


function getVapidPublic(req, res) {
  if (!process.env.VAPID_PUBLIC) {
    return res.status(503).json({ error: 'push not configured' });
  }
  res.json({ key: process.env.VAPID_PUBLIC });
}


function subscribe(req, res) {
  const { device_id, address } = req.auth;
  const { endpoint, keys } = req.body || {};

  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'endpoint and keys required' });
  }

  try {
    const db = getDb(address);
    db.prepare(`
      UPDATE devices
      SET push_endpoint = ?, push_p256dh = ?, push_auth = ?
      WHERE device_id = ?
    `).run(endpoint, keys.p256dh, keys.auth, device_id);
    db.close();
    res.json({ ok: true });
  } catch (e) {
    console.error('[push] subscribe error:', e.message);
    res.status(500).json({ error: 'db error' });
  }
}


async function sendPush(address, payload) {
  if (!process.env.VAPID_PUBLIC) return;

  let db;
  let devices;
  try {
    db = getDb(address);
    devices = db.prepare(`
      SELECT device_id, push_endpoint, push_p256dh, push_auth
      FROM devices
      WHERE push_endpoint IS NOT NULL
    `).all();
    db.close();
  } catch (e) {
    console.error('[push] sendPush db error:', e.message);
    return;
  }

  for (const dev of devices) {
    const devShort = dev.device_id.slice(0, 8);
    try {
      await webPush.sendNotification(
        { endpoint: dev.push_endpoint, keys: { p256dh: dev.push_p256dh, auth: dev.push_auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 }
      );
    } catch (e) {
      console.warn(`[push] ✗ device=${devShort} status=${e.statusCode} msg="${e.message}"`);
      if (e.statusCode === 410 || e.statusCode === 404) {
        console.warn(`[push] stale subscription, removing device=${devShort}`);
        try {
          const db2 = getDb(address);
          db2.prepare('UPDATE devices SET push_endpoint=NULL, push_p256dh=NULL, push_auth=NULL WHERE device_id=?').run(dev.device_id);
          db2.close();
        } catch {}
      }
    }
  }
}

module.exports = { initPush, getVapidPublic, subscribe, sendPush };

