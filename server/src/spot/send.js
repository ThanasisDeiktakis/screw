'use strict';
const { getDb } = require('./db');
const { broadcast } = require('./ws');
const { sendPush } = require('./push');

// ---------------------------------------------------------------------------
// deliverLocal — incoming: deliver message to a local user.
// Called for every recipient that belongs to this Spot.
// In the future, messages from remote Spots (via Hub) will enter here too.
// ---------------------------------------------------------------------------
function deliverLocal(addr, record, opts = {}) {
  const serverTs = Math.floor(Date.now() / 1000);
  try {
    const db = getDb(addr);
    db.prepare(`
      INSERT OR IGNORE INTO messages (message_id, server_ts, raw)
      VALUES (?, ?, ?)
    `).run(record.message_id, serverTs, JSON.stringify(record));
    db.close();
  } catch (e) {
    console.error(`[deliver] db error for ${addr.slice(0, 8)}:`, e.message);
    return false;
  }

  broadcast(addr, record);

  if (!opts.skipPush && !record.no_push) {
    const isHandshake = !!record.public_key;
    sendPush(addr, {
      title: 'Screw',
      body: isHandshake ? '🤝 New contact request' : '💬 New message',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      message_id: record.message_id,
    }).catch(() => {});
  }

  return true;
}

// ---------------------------------------------------------------------------
// isLocalUser — check if address belongs to this Spot (has a database).
// TODO: when Hubs are implemented, unknown addresses should be forwarded
// to the mesh network instead of being silently delivered.
// ---------------------------------------------------------------------------
function isLocalUser(addr) {
  const path = require('path');
  const fs = require('fs');
  const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
  return fs.existsSync(path.join(DATA_DIR, `user_${addr}.db`));
}

// ---------------------------------------------------------------------------
// send — outgoing: HTTP handler for POST /send.
// Accepts a message from an authenticated client, decides where each
// recipient lives, and routes accordingly.
// ---------------------------------------------------------------------------
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

  const errors = [];
  const remote = []; // addresses not on this Spot — will be forwarded later

  for (let i = 0; i < recipients.length; i++) {
    const addr = recipients[i];
    const record = { ...msg, to: addr };

    if (!isLocalUser(addr)) {
      // TODO: queue for outbound delivery via Hub
      remote.push(addr);
      continue;
    }

    const skipPush = i === 0 && recipients.length > 1;
    const ok = deliverLocal(addr, record, { skipPush });
    if (!ok) errors.push(addr);
  }

  const result = { ok: errors.length === 0, count: recipients.length };
  if (remote.length) result.remote = remote;
  if (errors.length) result.errors = errors;

  const status = errors.length ? 207 : 200;
  return res.status(status).json(result);
}

// ---------------------------------------------------------------------------
// receiveFromHub — HTTP handler for POST /hub/deliver.
// Accepts a message from a Hub, checks if recipient is local.
// 200 — delivered, 404 — unknown recipient, 400 — bad request.
// TODO: verify hub signature
// ---------------------------------------------------------------------------
function receiveFromHub(req, res) {
  const msg = req.body;
  if (!msg || !msg.message_id || !msg.to || !msg.timestamp) {
    return res.status(400).json({ error: 'message_id, to, timestamp required' });
  }
  if (!msg.payload && !msg.public_key) {
    return res.status(400).json({ error: 'payload or public_key required' });
  }

  const addr = msg.to;
  if (!isLocalUser(addr)) {
    return res.status(404).json({ error: 'recipient not found on this spot' });
  }

  const ok = deliverLocal(addr, msg);
  if (!ok) {
    return res.status(500).json({ error: 'delivery failed' });
  }

  return res.status(200).json({ ok: true });
}

module.exports = { send, deliverLocal, receiveFromHub };
