'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

function loadOrCreate() {
  if (!fs.existsSync(ENV_PATH)) {
    const jwtSecret = crypto.randomBytes(32).toString('hex');

    const { publicKey, privateKey } = require('web-push').generateVAPIDKeys();
    const lines = [
      `JWT_SECRET=${jwtSecret}`,
      `VAPID_PUBLIC=${publicKey}`,
      `VAPID_PRIVATE=${privateKey}`,
    ].join('\n') + '\n';
    fs.writeFileSync(ENV_PATH, lines, 'utf8');
    console.log('[env] .env created, keys generated');
  }

  require('dotenv').config({ path: ENV_PATH });
}

module.exports = { loadOrCreate };

