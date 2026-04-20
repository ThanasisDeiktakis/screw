'use strict';
const { getDb } = require('./db');
// GET /contacts
function list(req, res) {
  const { address } = req.auth;
  try {
    const db = getDb(address);
    const rows = db.prepare('SELECT contact_hash, encrypted, updated_at FROM contacts').all();
    db.close();
    return res.json({ contacts: rows });
  } catch (e) {
    console.error('[contacts] list error:', e.message);
    return res.status(500).json({ error: 'db error' });
  }
}
// PUT /contacts/:hash
function upsert(req, res) {
  const { address } = req.auth;
  const { hash } = req.params;
  const { encrypted } = req.body;
  if (!encrypted) return res.status(400).json({ error: 'encrypted required' });
  try {
    const db = getDb(address);
    db.prepare(`
      INSERT INTO contacts (contact_hash, encrypted, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(contact_hash) DO UPDATE SET
        encrypted  = excluded.encrypted,
        updated_at = excluded.updated_at
    `).run(hash, encrypted, Math.floor(Date.now() / 1000));
    db.close();
    return res.json({ ok: true });
  } catch (e) {
    console.error('[contacts] upsert error:', e.message);
    return res.status(500).json({ error: 'db error' });
  }
}
// DELETE /contacts/:hash
function remove(req, res) {
  const { address } = req.auth;
  const { hash } = req.params;
  try {
    const db = getDb(address);
    db.prepare('DELETE FROM contacts WHERE contact_hash = ?').run(hash);
    db.close();
    return res.json({ ok: true });
  } catch (e) {
    console.error('[contacts] delete error:', e.message);
    return res.status(500).json({ error: 'db error' });
  }
}
module.exports = { list, upsert, remove };
