'use strict';
const { getDb } = require('./db');
// GET /receive?since=<server_ts>

function receive(req, res) {
  const { address } = req.auth;
  const since = parseInt(req.query.since) || 0;
  try {
    const db = getDb(address);
    const rows = db.prepare(`
      SELECT raw, server_ts FROM messages
      WHERE server_ts > ?
      ORDER BY server_ts ASC
    `).all(since);
    db.close();
    const messages = rows.map(r => {
      const msg = JSON.parse(r.raw);
      msg.server_ts = r.server_ts;
      return msg;
    });
    return res.json({ messages });
  } catch (e) {
    console.error('[receive] db error:', e.message);
    return res.status(500).json({ error: 'db error' });
  }
}
module.exports = { receive };
