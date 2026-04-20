'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');

function getDb(address) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const dbPath = path.join(DATA_DIR, `user_${address}.db`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id  TEXT PRIMARY KEY,
      server_ts   INTEGER NOT NULL,
      raw         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      contact_hash  TEXT PRIMARY KEY,
      encrypted     TEXT NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      device_id      TEXT PRIMARY KEY,
      enc_pub_key    TEXT NOT NULL,
      sign_pub_key   TEXT NOT NULL,
      push_endpoint  TEXT,
      push_p256dh    TEXT,
      push_auth      TEXT,
      last_seen      INTEGER,
      created_at     INTEGER NOT NULL
    );
  `);
}

module.exports = { getDb };

