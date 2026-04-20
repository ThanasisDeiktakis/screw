'use strict';
const { getDb } = require('./db');
const { broadcast } = require('./ws');
const { sendPush } = require('./push');

// POST /send

function send(req, res) {
  const msg = req.body;
  if (!msg || !msg.message_id || !msg.to || !msg.timestamp) {
    return res.status(400).json({ error: 'message_id, to, timestamp required' });
  }
  if (!msg.payload && !msg.public_key) {
    return res.status(400).json({ error: 'payload or public_key required' });
  }


  const recipients = Array.isArray(msg.to) ? msg.to : [msg.to];
  if (!recipients.length) {
    return res.status(400).json({ error: 'to must not be empty' });
  }

  const serverTs = Math.floor(Date.now() / 1000);
  const errors   = [];

  for (let i = 0; i < recipients.length; i++) {
    const addr = recipients[i];

    const record = { ...msg, to: addr };

    try {
      const db = getDb(addr);
      db.prepare(`
        INSERT OR IGNORE INTO messages (message_id, server_ts, raw)
        VALUES (?, ?, ?)
      `).run(msg.message_id, serverTs, JSON.stringify(record));
      db.close();
    } catch (e) {
      console.error(`[send] db error for ${addr}:`, e.message);
      errors.push(addr);
      continue;
    }

    // WebSocket
    broadcast(addr, record);

    const skipPush = i === 0 && recipients.length > 1;
    if (!(msg.no_push || skipPush)) {
      const isHandshake = !!msg.public_key;
      sendPush(addr, {
        title: 'Screw',
        body: isHandshake ? '🤝 New contact request' : '💬 New message',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        message_id: msg.message_id,
      }).catch(() => {});
    }
  }

  if (errors.length) {
    return res.status(207).json({ ok: false, errors });
  }
  return res.json({ ok: true, count: recipients.length });
}
module.exports = { send };
