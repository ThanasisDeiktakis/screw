'use strict';
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');

const clients = new Map();
function register(address, ws) {
  if (!clients.has(address)) clients.set(address, new Set());
  clients.get(address).add(ws);
  console.log(`[ws] +${address.slice(0, 8)} (total: ${clients.get(address).size})`);
}
function unregister(address, ws) {
  const set = clients.get(address);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) clients.delete(address);
  console.log(`[ws] -${address.slice(0, 8)}`);
}
function broadcast(address, msg) {
  const set = clients.get(address);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(msg);
  for (const ws of set) {
    if (ws.readyState === 1 /* OPEN */) ws.send(data);
  }
}
function init(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {

    const { query } = url.parse(req.url, true);
    let auth;
    try {
      auth = jwt.verify(query.token, process.env.JWT_SECRET);
    } catch {
      ws.close(4401, 'unauthorized');
      return;
    }
    const { address } = auth;
    register(address, ws);
    ws.on('close', () => unregister(address, ws));
    ws.on('error', () => unregister(address, ws));

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  console.log('[ws] WebSocket server ready');
}

function isOnline(address) {
  const set = clients.get(address);
  return !!(set && set.size > 0);
}

module.exports = { init, broadcast, isOnline };
