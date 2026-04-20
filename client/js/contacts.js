


async function sendHandshake(toAddress, replyTo = null) {
  if (!_publicKey) return;

  const pubB64     = bufToB64(await crypto.subtle.exportKey('spki', _publicKey));
  const signPubB64 = bufToB64(await crypto.subtle.exportKey('spki', _signPubKey));

  try {
    const ts    = Math.floor(Date.now() / 1000);
    const msgId = 'msg-' + uuidv4();
    const body  = { message_id: msgId, to: toAddress, timestamp: ts, public_key: pubB64, sign_public_key: signPubB64, name: getMyName() };
    if (replyTo) body.reply_to = replyTo;

    await authedFetch(`${SERVER_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const convId = await personalConversationId(_address, toAddress);
    touchConversation(convId, toAddress, null, ts);
    _allMessages.push({
      message_id: msgId, timestamp: ts, conversation_id: convId,
      body: t('contact.sharedKey','🤝 You shared your public key'), isMine: true, isHandshake: true,
    });
    _allMessages.sort((a, b) => a.timestamp - b.timestamp);
    saveMessages();
    renderChat();
  } catch (e) {
    console.warn('Handshake failed:', e);
  }
}

async function retryHandshake(address) {
  await sendHandshake(address);
  const cid = await personalConversationId(_address, address);
  if (cid === _activeConvId) {
    const el = document.getElementById('no-key-notice');
    if (el) {
      const prev = el.textContent;
      el.textContent = t('contact.handshakeResent','✅ Handshake resent, waiting…');
      setTimeout(() => { el.textContent = prev; }, 3000);
    }
  }
}


async function handleIncomingHandshake(msg) {
  const pubKeyB64     = msg.public_key;
  const signPubKeyB64 = msg.sign_public_key || null;
  const senderName    = sanitizeName(msg.name);
  const isReply       = !!msg.reply_to;

  let fromAddress;
  try { fromAddress = await pubKeyToAddress(pubKeyB64); }
  catch { return; }

  const contacts = loadContacts();
  if (contacts.find(c => c.address === fromAddress && c.status === 'blocked')) return;

  const existing = contacts.find(c => c.address === fromAddress);

  if (existing) {
    let changed = false;

    if (!existing.pubKeyB64 || existing.status === 'pending') { existing.pubKeyB64 = pubKeyB64; changed = true; }
    if (signPubKeyB64 && existing.signPubKeyB64 !== signPubKeyB64) { existing.signPubKeyB64 = signPubKeyB64; changed = true; }
    if (existing.status === 'pending' || existing.status === 'unknown') { existing.status = 'active'; changed = true; }
    if (senderName && !existing.name) { existing.name = senderName; changed = true; }

    if (changed) {
      saveContacts(contacts);
      syncContactToServer(existing);
      renderContacts();
      const convId = await personalConversationId(_address, fromAddress);
      if (convId === _activeConvId) {
        document.getElementById('to').value = fromAddress;
        const sendArea = document.getElementById('send-area');
        const noKey    = document.getElementById('no-key-notice');
        if (sendArea) sendArea.style.display = '';
        if (noKey)    noKey.style.display = 'none';
      }
    }


    if (!isReply) await sendHandshake(fromAddress, msg.message_id);
  } else {
    const newC = { name: senderName, pubKeyB64, signPubKeyB64, address: fromAddress, status: 'unknown' };
    contacts.push(newC);
    saveContacts(contacts);
    syncContactToServer(newC);
    renderContacts();
    notifyNewContact();


    if (!isReply) await sendHandshake(fromAddress, msg.message_id);
  }

  const convId      = await personalConversationId(_address, fromAddress);
  const contact     = loadContacts().find(c => c.address === fromAddress);
  const displayName = (contact && contact.name) ? contact.name : fromAddress.slice(0, 16) + '…';

  touchConversation(convId, fromAddress, null, msg.timestamp);

  _allMessages.push({
    message_id: msg.message_id, timestamp: msg.timestamp, conversation_id: convId,
    body: `🤝 ${escapeHtml(displayName)} shared a public key`, isMine: false, isHandshake: true,
  });
  _allMessages.sort((a, b) => a.timestamp - b.timestamp);
  saveMessages();
  renderChat();
}

// ─── Sync─────────────────────────────────
async function contactAddressHash(address) {
  const buf = new TextEncoder().encode(address);
  const dig = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(dig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function encryptContact(contact) {
  return encryptPayload(_publicKey, JSON.stringify({
    name:          contact.name          || '',
    pubKeyB64:     contact.pubKeyB64     || null,
    signPubKeyB64: contact.signPubKeyB64 || null,
    address:       contact.address,
    status:        contact.status        || 'active',
  }));
}

async function decryptContact(encryptedBody) {
  const parsed = typeof encryptedBody === 'string' ? JSON.parse(encryptedBody) : encryptedBody;
  return decryptPayload(_privateKey, parsed);
}

async function syncContactToServer(contact) {
  if (!_address || !_publicKey) return;
  if (!isSyncContacts()) return;
  try {
    const hash      = await contactAddressHash(contact.address);
    const encrypted = await encryptContact(contact);
    await authedFetch(`${SERVER_URL}/contacts/${hash}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted: JSON.stringify(encrypted) }),
    });
  } catch (e) {
    console.warn('[contacts] sync to server failed:', e);
  }
}

async function deleteContactFromServer(address) {
  if (!_address) return;
  try {
    const hash = await contactAddressHash(address);
    await authedFetch(`${SERVER_URL}/contacts/${hash}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('[contacts] delete from server failed:', e);
  }
}

async function deleteAllContactsFromServer() {
  const contacts = loadContacts();
  await Promise.all(contacts.map(c => deleteContactFromServer(c.address)));
}

async function syncAllContactsToServer() {
  const contacts = loadContacts();
  for (const c of contacts) await syncContactToServer(c);
}

async function syncContactsFromServer() {
  if (!_address || !_privateKey) return;
  if (!isSyncContacts()) return;
  try {
    const res  = await authedFetch(`${SERVER_URL}/contacts`);
    const data = await res.json();
    if (!data.contacts || !data.contacts.length) return;

    const local   = loadContacts();
    let changed   = false;

    for (const row of data.contacts) {
      let remote;
      try { remote = await decryptContact(row.encrypted); }
      catch { continue; }

      const idx = local.findIndex(c => c.address === remote.address);
      if (idx === -1) {
        local.push(remote);
        changed = true;
      } else {
        const lc = local[idx];
        let lchanged = false;
        if (!lc.pubKeyB64     && remote.pubKeyB64)     { lc.pubKeyB64     = remote.pubKeyB64;     lchanged = true; }
        if (!lc.signPubKeyB64 && remote.signPubKeyB64) { lc.signPubKeyB64 = remote.signPubKeyB64; lchanged = true; }

        if (remote.name && remote.name !== lc.name)    { lc.name          = remote.name;           lchanged = true; }
        if (remote.status && lc.status !== 'blocked' && lc.status !== remote.status) {
          lc.status = remote.status; lchanged = true;
        }
        if (lchanged) changed = true;
      }
    }

    if (changed) { saveContacts(local); renderContacts(); }
  } catch (e) {
    console.warn('[contacts] sync from server failed:', e);
  }
}


function blockContactByAddress(address) {
  const contacts = loadContacts();
  const c = contacts.find(c => c.address === address);
  if (!c) return;
  c.status = 'blocked';
  saveContacts(contacts);
  syncContactToServer(c);
  if (_activeConvId) {
    personalConversationId(_address, address).then(cid => {
      if (cid === _activeConvId) {
        _activeConvId = null;
        localStorage.removeItem('screw-last-conv-id');
        const sendArea = document.getElementById('send-area');
        const noKey    = document.getElementById('no-key-notice');
        if (sendArea) sendArea.style.display = '';
        if (noKey)    noKey.style.display = 'none';
        renderChat();
      }
    });
  }
  renderContacts();
  if (document.getElementById('modal-contacts-popup').classList.contains('show')) renderContactsInPopup();
}

function unblockContact(address) {
  const contacts = loadContacts();
  const c = contacts.find(x => x.address === address);
  if (!c) return;
  c.status = 'active';
  saveContacts(contacts);
  syncContactToServer(c);
  renderContacts();
  if (document.getElementById('modal-contacts-popup').classList.contains('show')) renderContactsInPopup();
}

function forgetContactByAddress(address) {
  if (!confirm(t('contact.confirmDelete','Delete contact? It will be removed.'))) return;
  saveContacts(loadContacts().filter(c => c.address !== address));
  deleteContactFromServer(address);
  if (_activeConvId) {
    personalConversationId(_address, address).then(cid => {
      if (cid === _activeConvId) {
        _activeConvId = null;
        localStorage.removeItem('screw-last-conv-id');
        renderChat();
      }
    });
  }
  renderContacts();
  if (document.getElementById('modal-contacts-popup').classList.contains('show')) renderContactsInPopup();
}


function openAddByAddress() {
  document.getElementById('modal-addr-name').value     = '';
  document.getElementById('modal-addr-input').value    = '';
  document.getElementById('modal-addr-input').readOnly = false;
  document.getElementById('modal-addr-error').textContent = '';
  document.getElementById('modal-add-by-addr').classList.add('show');
}
function closeAddByAddress() {
  document.getElementById('modal-addr-input').readOnly = false;
  document.getElementById('modal-add-by-addr').classList.remove('show');
}

async function saveByAddress() {
  const name    = sanitizeName(document.getElementById('modal-addr-name').value);
  const rawAddr = document.getElementById('modal-addr-input').value.trim().toLowerCase();
  const address = validateAddress(rawAddr);
  const errEl   = document.getElementById('modal-addr-error');

  if (!address) { errEl.textContent = t('contact.invalidAddress','⚠ Address must be 32 hex characters'); return; }
  if (address === _address) { errEl.textContent = t('contact.ownAddress','⚠ This is your own address'); return; }

  const contacts = loadContacts();
  if (contacts.find(c => c.address === address)) { errEl.textContent = t('contact.alreadyExists','⚠ Contact already exists'); return; }

  const newContact = { name: name || '', pubKeyB64: null, address, status: 'pending' };
  contacts.push(newContact);
  saveContacts(contacts);
  syncContactToServer(newContact);
  closeAddByAddress();
  renderContacts();
  await sendHandshake(address);
}


function openEditContact(idx) {
  const c = loadContacts()[idx];
  if (!c) return;
  _editContactIdx = idx;
  document.getElementById('modal-edit-name').value = c.name || '';
  document.getElementById('modal-edit-addr').textContent = t('contact.addressLabel','address: ') + c.address;
  document.getElementById('modal-edit-contact').classList.add('show');
}
function closeEditContact() {
  _editContactIdx = null;
  document.getElementById('modal-edit-contact').classList.remove('show');
}
function saveEditContact() {
  if (_editContactIdx === null) return;
  const contacts = loadContacts();
  contacts[_editContactIdx].name = sanitizeName(document.getElementById('modal-edit-name').value);
  saveContacts(contacts);
  syncContactToServer(contacts[_editContactIdx]);
  closeEditContact();
  renderContacts();
}
function blockContact() {
  if (_editContactIdx === null) return;
  const c = loadContacts()[_editContactIdx];
  if (!c) return;
  closeEditContact();
  blockContactByAddress(c.address);
}
