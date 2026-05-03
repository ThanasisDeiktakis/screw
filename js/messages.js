

let _isSending = false;

function _lockSendUI() {
  _isSending = true;
  const payload   = document.getElementById('payload');
  const sendBtn   = document.getElementById('btn-send');
  const cancelBtn = document.getElementById('btn-file-cancel');
  if (payload)   payload.disabled             = true;
  if (sendBtn)   sendBtn.disabled             = true;
  if (cancelBtn) cancelBtn.style.visibility   = 'hidden';
}

function _unlockSendUI() {
  _isSending = false;
  const payload   = document.getElementById('payload');
  const sendBtn   = document.getElementById('btn-send');
  const cancelBtn = document.getElementById('btn-file-cancel');
  if (payload)   { payload.disabled = false; payload.focus(); }
  if (sendBtn)   sendBtn.disabled             = false;
  if (cancelBtn) cancelBtn.style.visibility   = '';
}


async function send() {
  if (_isSending) return;
  _lockSendUI();
  try {

    if (_pendingFile) {
      await maybeSendFile();
      return;
    }

    const rawPayload = document.getElementById('payload').value.trim();
    if (!rawPayload) return;


    if (_activeConvId && getGroup(_activeConvId)) {
      await sendGroupMessage(_activeConvId, rawPayload);
      document.getElementById('payload').value = '';
      if (typeof autoResizePayload === 'function') autoResizePayload();
      delete _drafts[_activeConvId];
      return;
    }


    const message_id = 'msg-' + uuidv4();
    const timestamp  = Math.floor(Date.now() / 1000);
    const toUuid     = document.getElementById('to').value.trim();
    if (!toUuid) return;

    const contacts = loadContacts();
    const contact  = contacts.find(c => c.address === toUuid);
    if (!contact) return;

    let recipientKey;
    try {
      recipientKey = await crypto.subtle.importKey(
        'spki', b64ToBuf(contact.pubKeyB64),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false, ['encrypt']
      );
    } catch (e) {
      console.error('Failed to import recipient key:', e);
      return;
    }

    const conversation_id = await personalConversationId(_address, toUuid);

    const envelopeBase     = { type: 'message', message_id, timestamp, from: _address, conversation_id, body: { text: rawPayload } };
    const envelopeBaseSelf = { type: 'message', message_id, timestamp, from: _address, conversation_id, body: { text: rawPayload }, peer: toUuid };

    const plaintextToSign     = JSON.stringify(envelopeBase);
    const plaintextToSignSelf = JSON.stringify(envelopeBaseSelf);
    const signature_raw       = await signEnvelope(plaintextToSign);
    const signature_raw_self  = await signEnvelope(plaintextToSignSelf);

    const isDebug = new URLSearchParams(location.search).get('debug') === '1';
    const signature     = isDebug
      ? signature_raw.slice(0, -1) + (signature_raw.at(-1) === 'A' ? 'B' : 'A')
      : signature_raw;
    const signatureSelf = signature_raw_self;
    if (isDebug) console.warn('[debug] signature deliberately corrupted:', signature_raw, '→', signature);

    const envelope     = { ...envelopeBase,     signature };
    const envelopeSelf = { ...envelopeBaseSelf, signature: signatureSelf };

    const encrypted     = await encryptPayload(recipientKey, JSON.stringify(envelope));
    const encryptedSelf = await encryptPayload(_publicKey,   JSON.stringify(envelopeSelf));

    const body     = JSON.stringify({ message_id, to: toUuid,   timestamp, conversation_id, payload: encrypted });
    const bodySelf = JSON.stringify({ message_id, to: _address, timestamp, conversation_id, payload: encryptedSelf, no_push: true });

    const [res] = await Promise.all([
      authedFetch(`${SERVER_URL}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      authedFetch(`${SERVER_URL}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodySelf }),
    ]);
    if (res.ok) {
      document.getElementById('payload').value = '';
      if (typeof autoResizePayload === 'function') autoResizePayload();
      delete _drafts[_activeConvId];
      fetchInbox();
    }
  } catch (e) {
    console.error('Send error:', e);
  } finally {
    _unlockSendUI();
  }
}


async function handleIncomingMessage(msg) {
  if (_seenIds.has(msg.message_id)) return;


  if (!validateMessageId(msg.message_id)) {
    console.warn('[msg] invalid message_id, dropped:', msg.message_id);

    if (msg.server_ts && msg.server_ts > _lastServerTimestamp) {
      _lastServerTimestamp = msg.server_ts;
      saveMessages();
    }
    if (msg.message_id != null) _seenIds.add(String(msg.message_id).slice(0, 256));
    return;
  }

  console.log('[msg] received:', msg.message_id, 'to:', msg.to, 'has_payload:', !!msg.payload, 'has_pubkey:', !!msg.public_key);

  // Updatesince server_ts
  if (msg.server_ts && msg.server_ts > _lastServerTimestamp) {
    _lastServerTimestamp = msg.server_ts;
    saveMessages();
  }


  if (msg.public_key && !msg.payload) {
    _seenIds.add(msg.message_id);
    handleIncomingHandshake(msg);
    return;
  }

  if (!msg.payload) return;


  if (msg.conversation_id && getGroup(msg.conversation_id)) {
    const handled = await handleGroupMessage(msg);
    if (handled) _seenIds.add(msg.message_id);
    return;
  }


  _seenIds.add(msg.message_id);

  decryptPayload(_privateKey, msg.payload)
    .then(async envelope => {
      const isMine   = envelope.from === _address;
      console.log('[msg] decrypted:', msg.message_id, 'isMine:', isMine, 'from:', envelope.from, 'peer:', envelope.peer, 'conv:', envelope.conversation_id);
      const contacts = loadContacts();

      if (!isMine) {
        const sender        = contacts.find(c => c.address === envelope.from);
        const signPubKeyB64 = sender?.signPubKeyB64 || null;
        if (signPubKeyB64 && envelope.signature) {
          const { signature, ...envelopeBase } = envelope;
          const valid = await verifyEnvelope(JSON.stringify(envelopeBase), signature, signPubKeyB64);
          if (!valid) {
            await pushWarning(msg.message_id, msg.timestamp, envelope.from,
              t('sig.invalid','⚠️ Invalid signature — someone may be impersonating your contact!'));
            return;
          }
        }
      }

      let displayName;
      if (isMine) {
        const toContact = contacts.find(c => c.address === msg.to);
        const toName    = toContact ? toContact.name : (msg.to || '').slice(0, 16) + '…';
        displayName = '📤 ' + escapeHtml(toName);
      } else {
        const contact  = contacts.find(c => c.address === envelope.from);
        const fromName = contact ? contact.name : envelope.from.slice(0, 16) + '…';
        displayName = '👤 ' + escapeHtml(fromName);
      }

      const msgType = envelope.type || 'message';
      let bodyText;
      let fileMeta = null;
      if (msgType === 'message') {
        bodyText = envelope.body?.text || '';
      } else if (msgType === 'file') {
        fileMeta = envelope.body || {};
        bodyText = fileMeta.caption || '';
      } else if (msgType === 'location') {

        bodyText = envelope.body?.caption || '';
      } else if (msgType === 'group_invite' || msgType === 'channel_invite') {

        await handleGroupInvite(envelope, msg);
        return;
      } else if (msgType === 'reaction') {
        handleIncomingReaction(envelope);
        return;
      } else if (msgType === 'delete') {
        handleIncomingDelete(envelope);
        return;
      } else {

        return;
      }

      _allMessages.push({
        message_id:      msg.message_id,
        timestamp:       msg.timestamp,
        conversation_id: envelope.conversation_id,
        from:            envelope.from,
        body:            bodyText,
        type:            msgType,
        fileMeta:        fileMeta,
        locationMeta:    msgType === 'location' ? envelope.body : null,
        isMine,
        displayName,
      });
      if (msgType === 'location' && envelope.body) {
        console.log('[location] decrypted: lat=', envelope.body.lat, 'lng=', envelope.body.lng);
      }
      _allMessages.sort((a, b) => a.timestamp - b.timestamp);
      saveMessages();

      // Update

      const peerAddr = isMine ? (envelope.peer || msg.to) : envelope.from;
      console.log('[msg] touchConversation:', envelope.conversation_id, 'peerAddr:', peerAddr);
      touchConversation(envelope.conversation_id, peerAddr, bodyText, msg.timestamp);

      if (!isMine && envelope.conversation_id !== _activeConvId) {
        _unreadCounts[envelope.conversation_id] = (_unreadCounts[envelope.conversation_id] || 0) + 1;
        saveUnreadCounts();
      }



      renderConversations();




      renderChat();
    })
    .catch(e => { console.warn('[msg] decrypt failed:', msg.message_id, e?.message || e); });
}


let _pendingFile = null;
let _serverMaxFileSize = null;

/** CalledappStart /config */
function initMessagesConfig() {
  const cfg = window.serverConfig;
  if (!cfg) return;
  if (cfg.files_max_size) {
    _serverMaxFileSize = cfg.files_max_size;
    _updateAttachFileLabel();
  }
}

function _updateAttachFileLabel() {
  const btn = document.getElementById('btn-attach-file');
  if (!btn) return;
  const limitStr = _serverMaxFileSize !== null ? ` (≤ ${formatFileSize(_serverMaxFileSize)})` : '';
  btn.textContent = `📎 ${t('file.label','File')}${limitStr}`;
}

function toggleAttachMenu() {
  const menu = document.getElementById('attach-menu');
  const btn  = document.getElementById('btn-attach');
  const open = menu.style.display === 'none';
  menu.style.display = open ? 'block' : 'none';
  btn.classList.toggle('active', open);
  if (open) {
    _updateAttachFileLabel();

    setTimeout(() => {
      document.addEventListener('click', _closeAttachMenu, { once: true });
    }, 0);
  }
}

function _closeAttachMenu(e) {
  const wrap = document.getElementById('attach-wrap');
  if (wrap && wrap.contains(e.target)) return;
  const menu = document.getElementById('attach-menu');
  const btn  = document.getElementById('btn-attach');
  if (menu) menu.style.display = 'none';
  if (btn)  btn.classList.remove('active');
}

function openFilePicker() {

  const menu = document.getElementById('attach-menu');
  const btn  = document.getElementById('btn-attach');
  if (menu) menu.style.display = 'none';
  if (btn)  btn.classList.remove('active');

  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '*/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    _setPendingFile(file);
  };
  input.click();
}

function _setPendingFile(file) {

  if (_serverMaxFileSize !== null && file.size > _serverMaxFileSize) {
    alert(`${t('file.tooLarge','File too large')}: ${formatFileSize(file.size)}. Max: ${formatFileSize(_serverMaxFileSize)}`);
    return;
  }
  _pendingFile = file;
  const bar     = document.getElementById('file-preview-bar');
  const content = document.getElementById('file-preview-content');

  const sizeStr  = formatFileSize(file.size);
  const safeName = escapeHtml(file.name);
  const isImage  = file.type.startsWith('image/');

  if (isImage) {
    const reader = new FileReader();
    reader.onload = e => {
      content.innerHTML = `<img src="${e.target.result}" alt=""><span class="fp-name">${safeName}</span><span class="fp-size">${sizeStr}</span>`;
    };
    reader.readAsDataURL(file);
  } else {
    content.innerHTML = `<span class="fp-icon">📎</span><span class="fp-name">${safeName}</span><span class="fp-size">${sizeStr}</span>`;
  }

  bar.style.display = 'flex';

  document.getElementById('payload').focus();
}

function cancelFileAttach() {
  _pendingFile = null;
  document.getElementById('file-preview-bar').style.display = 'none';
  document.getElementById('file-preview-content').innerHTML = '';
}

// Calledsend() — _pendingFile, ,
async function maybeSendFile() {
  if (!_pendingFile) return false;
  const caption = document.getElementById('payload').value.trim();
  await sendFile(_pendingFile, caption);
  cancelFileAttach();
  document.getElementById('payload').value = '';
  if (typeof autoResizePayload === 'function') autoResizePayload();
  return true;
}

async function sendFile(file, caption = '') {
  if (!_activeConvId) return;

  const isGroup  = !!getGroup(_activeConvId);
  const toUuid   = document.getElementById('to').value.trim();
  if (!isGroup && !toUuid) return;

  const contacts = loadContacts();

  // 1. Encrypt
  const fileBytes   = await file.arrayBuffer();
  const { blob, fileKeyB64 } = await encryptFile(fileBytes);
  const checksum    = await fileSha256(blob);

  // 2. Requestpresigned URL
  let uploadData;
  try {
    const r = await authedFetch(`${SERVER_URL}/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: file.size }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(t('file.serverError','Server error: ') + (err.error || r.status));
      return;
    }
    uploadData = await r.json();
    // Remember_setPendingFile
    if (uploadData.max_size) {
      _serverMaxFileSize = uploadData.max_size;
      _updateAttachFileLabel();
    }
  } catch (e) {
    alert(t('file.uploadLinkError','Failed to get upload link: ') + e.message);
    return;
  }


  if (uploadData.max_size && file.size > uploadData.max_size) {
    alert(`${t('file.tooLarge','File too large')}: ${formatFileSize(file.size)}. Max: ${formatFileSize(uploadData.max_size)}`);
    return;
  }

  // 3. LoadS3


  try {
    const putRes = await fetch(uploadData.upload_url, {
      method: 'PUT',
      body:   blob,
    });
    if (!putRes.ok) {
      alert(t('file.uploadError','Upload error: HTTP ') + putRes.status);
      return;
    }
  } catch (e) {
    alert(t('file.uploadError','Upload error: ') + e.message);
    return;
  }

  // 4. Buildenvelope
  const message_id = 'msg-' + uuidv4();
  const timestamp  = Math.floor(Date.now() / 1000);

  const fileBody = {
    url:        uploadData.download_url,
    file_key:   fileKeyB64,
    filename:   file.name,
    mime_type:  file.type || 'application/octet-stream',
    size:       file.size,
    checksum,
    expires_at: uploadData.expires_at,
    caption,
  };

  if (isGroup) {
    const envelopeBase = {
      type:            'file',
      message_id,
      timestamp,
      from:            _address,
      conversation_id: _activeConvId,
      body:            fileBody,
    };
    const signature = await signEnvelope(JSON.stringify(envelopeBase));
    const envelope  = { ...envelopeBase, signature };
    await sendGroupMessage(_activeConvId, null, envelope);
    return;
  }


  const contact = contacts.find(c => c.address === toUuid);
  if (!contact) return;

  let recipientKey;
  try {
    recipientKey = await crypto.subtle.importKey(
      'spki', b64ToBuf(contact.pubKeyB64),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
    );
  } catch (e) { return; }

  const conversation_id = await personalConversationId(_address, toUuid);

  const envelopeBase     = { type: 'file', message_id, timestamp, from: _address, conversation_id, body: fileBody };
  const envelopeBaseSelf = { type: 'file', message_id, timestamp, from: _address, conversation_id, body: fileBody, peer: toUuid };

  const signature     = await signEnvelope(JSON.stringify(envelopeBase));
  const signatureSelf = await signEnvelope(JSON.stringify(envelopeBaseSelf));

  const envelope     = { ...envelopeBase,     signature };
  const envelopeSelf = { ...envelopeBaseSelf, signature: signatureSelf };

  const encrypted     = await encryptPayload(recipientKey, JSON.stringify(envelope));
  const encryptedSelf = await encryptPayload(_publicKey,   JSON.stringify(envelopeSelf));

  const body     = JSON.stringify({ message_id, to: toUuid,   timestamp, conversation_id, payload: encrypted });
  const bodySelf = JSON.stringify({ message_id, to: _address, timestamp, conversation_id, payload: encryptedSelf, no_push: true });

  try {
    await Promise.all([
      authedFetch(`${SERVER_URL}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      authedFetch(`${SERVER_URL}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodySelf }),
    ]);
    fetchInbox();
  } catch (e) {
    console.error('File send error:', e);
  }
}


async function fetchInbox() {
  if (!_address) return;
  try {
    const res  = await authedFetch(`${SERVER_URL}/receive?since=${_lastServerTimestamp}`);
    const data = await res.json();
    const status = document.getElementById('inbox-status');
    if (status) status.textContent = `${t('chat.updated','updated')}: ${new Date().toLocaleTimeString()}`;

    for (const msg of (data.messages || [])) {
      await handleIncomingMessage(msg);
    }
  } catch (e) {
    const status = document.getElementById('inbox-status');
    if (status) status.textContent = '❌ ' + e.message;
  }
}

async function pushWarning(msgId, timestamp, fromAddress, text) {
  const convId = await personalConversationId(_address, fromAddress);
  _allMessages.push({
    message_id:      msgId,
    timestamp,
    conversation_id: convId,
    body:            text,
    isMine:          false,
    isWarning:       true,
    displayName:     t('sig.warning','⚠️ Warning'),
  });
  _allMessages.sort((a, b) => a.timestamp - b.timestamp);
  saveMessages();
  renderChat();
}



// Apply_reactions
function handleIncomingReaction(envelope) {
  const { from, body } = envelope;
  if (!body?.reply_to || !body?.emoji || !from) return;

  const { reply_to: msgId, emoji, action = 'add' } = body;


  if (!validateMessageId(msgId)) {
    console.warn('[reaction] invalid reply_to, dropped:', msgId);
    return;
  }

  if (!_reactions[msgId]) _reactions[msgId] = {};
  if (!_reactions[msgId][emoji]) _reactions[msgId][emoji] = [];

  const list = _reactions[msgId][emoji];
  const idx  = list.indexOf(from);

  if (action === 'add' && idx === -1) {
    list.push(from);
  } else if (action === 'remove' && idx !== -1) {
    list.splice(idx, 1);
    if (list.length === 0) delete _reactions[msgId][emoji];
    if (Object.keys(_reactions[msgId]).length === 0) delete _reactions[msgId];
  }

  saveReactions();
  renderReactions(msgId);
}


async function sendReaction(targetMsgId, emoji, action = 'add') {
  const targetMsg = _allMessages.find(m => m.message_id === targetMsgId);
  if (!targetMsg) return;

  const conversationId = targetMsg.conversation_id;
  const timestamp      = Math.floor(Date.now() / 1000);
  const group          = getGroup(conversationId);

  const envelopeBase = {
    type:            'reaction',
    from:            _address,
    conversation_id: conversationId,
    message_id:      'msg-' + uuidv4(),
    timestamp,
    body: { reply_to: targetMsgId, emoji, action },
  };
  envelopeBase.signature = await signEnvelope(JSON.stringify(envelopeBase));

  if (group) {

    const encrypted = await encryptWithGroupKey(group.group_key, JSON.stringify(envelopeBase));
    await authedFetch(`${SERVER_URL}/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message_id:      envelopeBase.message_id,
        to:              group.roster,
        timestamp,
        conversation_id: conversationId,
        payload:         encrypted,
      }),
    });


  } else {

    const contacts    = loadContacts();
    const convs       = loadConversations();
    const peerAddress = targetMsg.isMine
      ? convs.find(c => c.conversation_id === conversationId)?.peerAddress
      : targetMsg.from;
    if (!peerAddress) return;

    const contact = contacts.find(c => c.address === peerAddress);
    if (!contact?.pubKeyB64) return;

    let recipientKey;
    try {
      recipientKey = await crypto.subtle.importKey(
        'spki', b64ToBuf(contact.pubKeyB64),
        { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
      );
    } catch { return; }

    const selfMsgId    = 'msg-' + uuidv4();
    const envelopeSelf = { ...envelopeBase, message_id: selfMsgId };

    const [encRecipient, encSelf] = await Promise.all([
      encryptPayload(recipientKey, JSON.stringify(envelopeBase)),
      encryptPayload(_publicKey,   JSON.stringify(envelopeSelf)),
    ]);

    await Promise.all([
      authedFetch(`${SERVER_URL}/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message_id: envelopeBase.message_id, to: peerAddress, timestamp, conversation_id: conversationId, payload: encRecipient }),
      }),
      authedFetch(`${SERVER_URL}/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message_id: selfMsgId, to: _address, timestamp, conversation_id: conversationId, payload: encSelf, no_push: true }),
      }),
    ]);

    // Apply

    _seenIds.add(envelopeBase.message_id);
    _seenIds.add(selfMsgId);
    handleIncomingReaction(envelopeBase);
  }
}


// ---------------------------------------------------------------------------
// Delete message
// ---------------------------------------------------------------------------

function handleIncomingDelete(envelope) {
  const { body } = envelope;
  if (!body?.reply_to) return;
  const msgId = body.reply_to;
  removeLocalMessage(msgId);
}

function removeLocalMessage(msgId) {
  const idx = _allMessages.findIndex(m => m.message_id === msgId);
  if (idx !== -1) _allMessages.splice(idx, 1);
  delete _reactions[msgId];
  saveMessages();
  saveReactions();
  // Remove from DOM
  const el = document.getElementById(msgId);
  if (el) el.remove();
  // Delete from server DB
  authedFetch(`${SERVER_URL}/messages/${encodeURIComponent(msgId)}`, { method: 'DELETE' }).catch(() => {});
}

async function deleteMessage(msgId) {
  const targetMsg = _allMessages.find(m => m.message_id === msgId);
  if (!targetMsg) return;

  const isMine = targetMsg.isMine;
  const conversationId = targetMsg.conversation_id;

  if (!isMine) {
    // Foreign message — just delete locally
    removeLocalMessage(msgId);
    return;
  }

  // Own message — send delete request to recipient
  const timestamp = Math.floor(Date.now() / 1000);
  const group = getGroup(conversationId);

  const envelopeBase = {
    type:            'delete',
    from:            _address,
    conversation_id: conversationId,
    message_id:      'msg-' + uuidv4(),
    timestamp,
    body: { reply_to: msgId },
  };
  envelopeBase.signature = await signEnvelope(JSON.stringify(envelopeBase));

  if (group) {
    const encrypted = await encryptWithGroupKey(group.group_key, JSON.stringify(envelopeBase));
    await authedFetch(`${SERVER_URL}/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message_id:      envelopeBase.message_id,
        to:              group.roster,
        timestamp,
        conversation_id: conversationId,
        payload:         encrypted,
      }),
    });
  } else {
    const convs       = loadConversations();
    const peerAddress = convs.find(c => c.conversation_id === conversationId)?.peerAddress;
    if (!peerAddress) { removeLocalMessage(msgId); return; }

    const contacts = loadContacts();
    const contact  = contacts.find(c => c.address === peerAddress);
    if (!contact?.pubKeyB64) { removeLocalMessage(msgId); return; }

    let recipientKey;
    try {
      recipientKey = await crypto.subtle.importKey(
        'spki', b64ToBuf(contact.pubKeyB64),
        { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
      );
    } catch { removeLocalMessage(msgId); return; }

    const encRecipient = await encryptPayload(recipientKey, JSON.stringify(envelopeBase));
    await authedFetch(`${SERVER_URL}/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message_id: envelopeBase.message_id, to: peerAddress, timestamp, conversation_id: conversationId, payload: encRecipient }),
    });
  }

  // Delete locally
  removeLocalMessage(msgId);
}


let _locationPickerMap = null;
let _locationPickerCoords = null; // { lat, lng }

function openLocationPicker() {

  const menu = document.getElementById('attach-menu');
  const btn  = document.getElementById('btn-attach');
  if (menu) menu.style.display = 'none';
  if (btn)  btn.classList.remove('active');

  _locationPickerCoords = null;
  document.getElementById('location-picker-coords').textContent = t('location.noCoords','no coordinates selected');
  document.getElementById('btn-location-send').disabled = true;
  document.getElementById('modal-location-picker').classList.add('show');


  setTimeout(() => {
    if (_locationPickerMap) {
      _locationPickerMap.destroy();
      _locationPickerMap = null;
    }
    _locationPickerMap = new KartaJS('location-picker-map', {
      zoom:   13,
      center: [55.7558, 37.6173],
      tile:   'osm',
    });


    _locationPickerMap.on('click', (e) => {
      const lat = e.data.latlng[0];
      const lng = e.data.latlng[1];
      _locationPickerCoords = { lat, lng };
      document.getElementById('location-picker-coords').textContent =
        `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      document.getElementById('btn-location-send').disabled = false;

      _locationPickerMap.clearMarkers();
      _locationPickerMap.addMarker({ lat, lng, title: t('location.selectedPoint','Selected point'), color: 'red', popup: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, showPopup: true });
    });
  }, 100);
}

function closeLocationPicker() {
  document.getElementById('modal-location-picker').classList.remove('show');
  if (_locationPickerMap) {
    _locationPickerMap.destroy();
    _locationPickerMap = null;
  }
  _locationPickerCoords = null;
}

function locationPickerUseMyPos() {
  if (!navigator.geolocation) {
    alert(t('location.notSupported','Geolocation not supported'));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      _locationPickerCoords = { lat, lng };
      document.getElementById('location-picker-coords').textContent =
        `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      document.getElementById('btn-location-send').disabled = false;
      if (_locationPickerMap) {
        _locationPickerMap.setCenter([lat, lng]);
        _locationPickerMap.setZoom(15);
        _locationPickerMap.clearMarkers();
        _locationPickerMap.addMarker({ lat, lng, title: t('location.myLocation','My location'), color: 'blue', popup: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, showPopup: true });
      }
    },
    () => alert(t('location.permissionError','Could not get coordinates. Check permissions.'))
  );
}

async function locationPickerSend() {
  if (!_locationPickerCoords) return;
  const { lat, lng } = _locationPickerCoords;
  closeLocationPicker();
  await sendLocation(lat, lng);
}

async function sendLocation(lat, lng, caption = '') {
  const toUuid  = document.getElementById('to').value.trim();
  const isGroup = _activeConvId && !!getGroup(_activeConvId);

  const message_id = 'msg-' + uuidv4();
  const timestamp  = Math.floor(Date.now() / 1000);

  const locationBody = { lat, lng };
  if (caption) locationBody.caption = caption;
  console.log('[location] sending: lat=', lat, 'lng=', lng);

  const envelopeBase = {
    type:            'location',
    message_id,
    timestamp,
    from:            _address,
    conversation_id: _activeConvId,
    body:            locationBody,
  };
  const signature = await signEnvelope(JSON.stringify(envelopeBase));
  const envelope  = { ...envelopeBase, signature };

  if (isGroup) {
    await sendGroupMessage(_activeConvId, null, envelope);
    return;
  }


  const contacts = loadContacts();
  const contact  = contacts.find(c => c.address === toUuid);
  if (!contact?.pubKeyB64) return;

  let recipientKey;
  try {
    recipientKey = await crypto.subtle.importKey(
      'spki', b64ToBuf(contact.pubKeyB64),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
    );
  } catch { return; }

  const conversation_id = await personalConversationId(_address, toUuid);
  const envelopeBaseSelf = { ...envelopeBase, conversation_id, peer: toUuid };
  const signatureSelf    = await signEnvelope(JSON.stringify(envelopeBaseSelf));
  const envelopeSelf     = { ...envelopeBaseSelf, signature: signatureSelf };

  const [encrypted, encryptedSelf] = await Promise.all([
    encryptPayload(recipientKey, JSON.stringify(envelope)),
    encryptPayload(_publicKey,   JSON.stringify(envelopeSelf)),
  ]);

  await Promise.all([
    authedFetch(`${SERVER_URL}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id, to: toUuid,   timestamp, conversation_id, payload: encrypted }) }),
    authedFetch(`${SERVER_URL}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id, to: _address, timestamp, conversation_id, payload: encryptedSelf, no_push: true }) }),
  ]);
  fetchInbox();
}

function startPolling() {

  connectWs();

  fetchInbox();
  _pollInterval = setInterval(fetchInbox, 60000);



  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      connectWs();
      fetchInbox();
    }
  });
}

