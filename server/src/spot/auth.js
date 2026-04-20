'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getDb } = require('./db');


function pubKeyToAddress(spkiB64) {
  const buf = Buffer.from(spkiB64, 'base64');
  const hash = crypto.createHash('sha256').update(buf).digest();
  return hash.slice(0, 16).toString('hex');
}

// POST /auth/register
async function register(req, res) {
  const { device_id, enc_pub_key, sign_pub_key } = req.body;
  if (!device_id || !enc_pub_key || !sign_pub_key) {
    return res.status(400).json({ error: 'device_id, enc_pub_key, sign_pub_key required' });
  }

  const address = pubKeyToAddress(enc_pub_key);
  const db = getDb(address);


  db.prepare(`
    INSERT INTO devices (device_id, enc_pub_key, sign_pub_key, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      enc_pub_key  = excluded.enc_pub_key,
      sign_pub_key = excluded.sign_pub_key,
      last_seen    = excluded.created_at
  `).run(device_id, enc_pub_key, sign_pub_key, Math.floor(Date.now() / 1000));

  db.close();

  const challenge = crypto.randomBytes(32).toString('hex');

  challenges.set(device_id, { challenge, address, ts: Date.now() });

  return res.json({ challenge });
}

// POST /auth/verify
async function verify(req, res) {
  const { device_id, challenge, signature } = req.body;
  if (!device_id || !challenge || !signature) {
    return res.status(400).json({ error: 'device_id, challenge, signature required' });
  }

  const stored = challenges.get(device_id);
  if (!stored || stored.challenge !== challenge) {
    return res.status(401).json({ error: 'invalid challenge' });
  }


  if (Date.now() - stored.ts > 5 * 60 * 1000) {
    challenges.delete(device_id);
    return res.status(401).json({ error: 'challenge expired' });
  }

  const { address } = stored;
  const db = getDb(address);
  const device = db.prepare('SELECT sign_pub_key FROM devices WHERE device_id = ?').get(device_id);
  db.close();

  if (!device) return res.status(401).json({ error: 'device not found' });

  // CheckRSA-PSS 
  try {
    const keyObj = crypto.createPublicKey({
      key: Buffer.from(device.sign_pub_key, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const ok = crypto.verify(
      'sha256',
      Buffer.from(challenge),
      { key: keyObj, padding: crypto.constants.RSA_PKCS1_PSS_PADDING },
      Buffer.from(signature, 'base64')
    );
    if (!ok) throw new Error('bad signature');
  } catch {
    return res.status(401).json({ error: 'signature verification failed' });
  }

  challenges.delete(device_id);

  // Updatelast_seen
  const db2 = getDb(address);
  db2.prepare('UPDATE devices SET last_seen = ? WHERE device_id = ?')
    .run(Math.floor(Date.now() / 1000), device_id);
  db2.close();

  const token = jwt.sign(
    { device_id, address },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.json({ token });
}


const challenges = new Map();

module.exports = { register, verify };

