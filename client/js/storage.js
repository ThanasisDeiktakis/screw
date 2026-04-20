
// { syncContacts: bool, syncMessages: bool, showSystemMessages: bool }
function loadPrivacySettings() {
  try {
    const raw = localStorage.getItem('screw-privacy');
    if (raw) return { showSystemMessages: false, ...JSON.parse(raw) };
  } catch {}

  return { syncContacts: true, syncMessages: true, showSystemMessages: false };
}
function savePrivacySettings$internal(settings) {
  localStorage.setItem('screw-privacy', JSON.stringify(settings));
}
function isSyncContacts()       { return loadPrivacySettings().syncContacts; }
function isSyncMessages()       { return loadPrivacySettings().syncMessages; }
function isShowSystemMessages() { return loadPrivacySettings().showSystemMessages; }

// ─── IndexedDB ───────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}



// status: 'unknown' | 'active' | 'pending' | 'archived' | 'blocked'

function loadContacts() {
  try { return JSON.parse(localStorage.getItem('screw-contacts') || '[]'); }
  catch { return []; }
}
function saveContacts(contacts) {
  localStorage.setItem('screw-contacts', JSON.stringify(contacts));
}


function loadMessages() {
  try {
    const raw = localStorage.getItem('screw-messages');
    if (raw) {
      _allMessages = JSON.parse(raw);
      _allMessages.forEach(m => { if (m.message_id) _seenIds.add(m.message_id); });
    }
    const ts = localStorage.getItem('screw-last-server-ts');
    if (ts) _lastServerTimestamp = parseInt(ts, 10) || 0;
  } catch (e) {
    console.warn('loadMessages failed:', e);
  }
}
function saveMessages() {
  try {
    localStorage.setItem('screw-messages', JSON.stringify(_allMessages));
    localStorage.setItem('screw-last-server-ts', String(_lastServerTimestamp));
  } catch (e) {
    console.warn('saveMessages failed:', e);
  }
}


function getMyName() {
  return localStorage.getItem('screw-my-name') || '';
}
function setMyName(name) {
  localStorage.setItem('screw-my-name', sanitizeName(name));
}



function loadReactions() {
  try {
    const raw = localStorage.getItem('screw-reactions');
    if (raw) _reactions = JSON.parse(raw) || {};
  } catch { _reactions = {}; }
}
function saveReactions() {
  try {
    localStorage.setItem('screw-reactions', JSON.stringify(_reactions));
  } catch (e) {
    console.warn('saveReactions failed:', e);
  }
}

function loadUnreadCounts() {
  try {
    const raw = localStorage.getItem('screw-unread');
    if (raw) _unreadCounts = JSON.parse(raw) || {};
  } catch { _unreadCounts = {}; }
}
function saveUnreadCounts() {
  localStorage.setItem('screw-unread', JSON.stringify(_unreadCounts));
}



//           folder?: null|'starred'|'archived' }
function loadConversations() {
  try { return JSON.parse(localStorage.getItem('screw-conversations') || '[]'); }
  catch { return []; }
}
function saveConversations(convs) {
  localStorage.setItem('screw-conversations', JSON.stringify(convs));
}


function setConversationFolder(conversationId, folder) {
  const convs = loadConversations();
  const conv  = convs.find(c => c.conversation_id === conversationId);
  if (conv) {
    conv.folder = folder || null;
    saveConversations(convs);
  }
}


function touchConversation(conversationId, peerAddress, bodyText, timestamp) {
  const convs = loadConversations();
  let conv = convs.find(c => c.conversation_id === conversationId);
  if (!conv) {
    conv = { conversation_id: conversationId, type: 'direct', peerAddress };
    convs.push(conv);
  }
  if (bodyText !== null && bodyText !== undefined) conv.lastMessage = bodyText;
  if (timestamp > (conv.lastTs || 0)) conv.lastTs = timestamp;
  if (peerAddress) conv.peerAddress = peerAddress;
  convs.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  saveConversations(convs);
}


async function fixMissingPeerAddresses(myAddress) {
  if (!myAddress) return;
  const convs = loadConversations();
  const broken = convs.filter(c => !c.peerAddress && c.type === 'direct');
  if (!broken.length) return;

  const contacts = loadContacts();
  let changed = false;

  for (const conv of broken) {
    for (const c of contacts) {
      if (!c.address) continue;
      try {
        const cid = await personalConversationId(myAddress, c.address);
        if (cid === conv.conversation_id) {
          conv.peerAddress = c.address;
          changed = true;
          break;
        }
      } catch {}
    }
  }

  if (changed) saveConversations(convs);
}
async function rebuildConversationsIfNeeded() {
  if (loadConversations().length > 0) return;
  if (!_allMessages.length) return;

  const map = new Map();
  for (const m of _allMessages) {
    if (!m.conversation_id) continue;
    const existing = map.get(m.conversation_id);
    const ts = m.timestamp || 0;
    if (!existing || ts > existing.lastTs) {
      map.set(m.conversation_id, {
        conversation_id: m.conversation_id,
        type: 'direct',
        peerAddress: (!m.isMine && m.from) ? m.from : (existing?.peerAddress || null),
        lastMessage: m.isHandshake ? (existing?.lastMessage || null) : (m.body || null),
        lastTs: ts,
      });
    }
  }


  if (typeof loadContacts === 'function' && typeof personalConversationId === 'function') {
    const contacts = loadContacts();
    for (const [convId, conv] of map.entries()) {
      if (conv.peerAddress) continue;
      for (const c of contacts) {
        if (!c.address) continue;
        try {
          const cid = await personalConversationId(
            localStorage.getItem('screw-address') || '', c.address
          );
          if (cid === convId) { conv.peerAddress = c.address; break; }
        } catch {}
      }
    }
  }

  if (map.size > 0) {
    const convs = Array.from(map.values()).sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    saveConversations(convs);
  }
}

