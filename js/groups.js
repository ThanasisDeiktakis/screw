

//           roster: [addr,...], roster_version, is_owner, owner_address }

function loadGroups() {
  try { return JSON.parse(localStorage.getItem('screw-groups') || '[]'); }
  catch { return []; }
}
function saveGroups(groups) {
  localStorage.setItem('screw-groups', JSON.stringify(groups));
}
function getGroup(conversationId) {
  return loadGroups().find(g => g.conversation_id === conversationId) || null;
}
function saveGroup(group) {
  const groups = loadGroups();
  const idx = groups.findIndex(g => g.conversation_id === group.conversation_id);
  if (idx === -1) groups.push(group);
  else groups[idx] = group;
  saveGroups(groups);
}


async function createGroup(topic, type = 'group') {
  const conversation_id = uuidv4().replace(/-/g, '');  // random 32 hex
  const group_key       = await generateGroupKey();
  const roster          = [_address];
  const rv              = await rosterVersion(roster);

  const group = {
    conversation_id,
    type,
    topic,
    group_key,
    roster,
    roster_version: rv,
    is_owner:       true,
    owner_address:  _address,
  };
  saveGroup(group);

  // Add
  touchConversation(conversation_id, null, null, Math.floor(Date.now() / 1000));
  const convs = loadConversations();
  const conv  = convs.find(c => c.conversation_id === conversation_id);
  if (conv) { conv.name = topic; conv.type = type; saveConversations(convs); }


  await sendGroupInvite(group, [_address]);

  renderConversations();
  return group;
}


async function sendGroupInvite(group, recipientAddresses) {
  const contacts = loadContacts();
  const ts = Math.floor(Date.now() / 1000);

  const inviteBody = {
    type:            group.type === 'channel' ? 'channel_invite' : 'group_invite',
    conversation_id: group.conversation_id,
    topic:           group.topic,
    group_key:       group.group_key,
    roster:          group.roster,
    roster_version:  group.roster_version,
  };

  for (const addr of recipientAddresses) {

    let recipientKey;
    if (addr === _address) {
      recipientKey = _publicKey;
    } else {
      const contact = contacts.find(c => c.address === addr);
      if (!contact?.pubKeyB64) continue;
      try {
        recipientKey = await crypto.subtle.importKey(
          'spki', b64ToBuf(contact.pubKeyB64),
          { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
        );
      } catch { continue; }
    }

    const msgId     = 'msg-' + uuidv4();
    const envelope  = {
      type:            inviteBody.type,
      from:            _address,
      conversation_id: group.conversation_id,
      message_id:      msgId,
      timestamp:       ts,
      body:            inviteBody,
    };
    envelope.signature = await signEnvelope(JSON.stringify(envelope));

    const encrypted = await encryptPayload(recipientKey, JSON.stringify(envelope));
    await authedFetch(`${SERVER_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: msgId, to: addr, timestamp: ts, payload: encrypted }),
    });
  }
}


async function addMemberToGroup(conversationId, memberAddress) {
  const group = getGroup(conversationId);
  if (!group) return;
  if (group.roster.includes(memberAddress)) return;

  group.roster.push(memberAddress);
  group.roster_version = await rosterVersion(group.roster);
  saveGroup(group);


  await sendGroupInvite(group, group.roster);

  // Update
  const convs = loadConversations();
  const conv  = convs.find(c => c.conversation_id === conversationId);
  if (conv) { conv.name = group.topic; conv.type = group.type; saveConversations(convs); }
  renderConversations();
}


async function removeMemberFromGroup(conversationId, memberAddress) {
  const group = getGroup(conversationId);
  if (!group) return;

  group.roster     = group.roster.filter(a => a !== memberAddress);
  group.group_key  = await generateGroupKey();
  group.roster_version = await rosterVersion(group.roster);
  saveGroup(group);


  await sendGroupInvite(group, group.roster);
  renderConversations();
}


async function handleGroupInvite(envelope, msg) {
  const body = envelope.body;
  if (!body?.conversation_id || !body?.group_key || !body?.roster) return;

  const existing  = getGroup(body.conversation_id);
  const isSelfSync = envelope.from === _address;

  const group = {
    conversation_id: body.conversation_id,
    type:            envelope.type === 'channel_invite' ? 'channel' : 'group',
    topic:           body.topic || t('group.untitled','Untitled'),
    group_key:       body.group_key,
    roster:          body.roster,
    roster_version:  body.roster_version,
    is_owner:        isSelfSync,
    owner_address:   isSelfSync ? _address : envelope.from,
  };


  if (existing?.is_owner) group.is_owner = true;

  saveGroup(group);

  // Add
  const convs = loadConversations();
  let conv = convs.find(c => c.conversation_id === group.conversation_id);
  if (!conv) {
    conv = { conversation_id: group.conversation_id, type: group.type, name: group.topic, lastTs: msg.timestamp };
    convs.unshift(conv);
  } else {
    conv.name = group.topic;
    conv.type = group.type;
  }
  convs.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  saveConversations(convs);


  if (!isSelfSync) {
    const inviteType = group.type === 'channel' ? t('group.channel','channel') : t('group.group','group');
    _allMessages.push({
      message_id:      msg.message_id,
      timestamp:       msg.timestamp,
      conversation_id: group.conversation_id,
      body:            `📨 ${t('group.invited','Added to')} ${inviteType} «${escapeHtml(group.topic)}» (${group.roster.length})`,
      isMine:          false,
      isHandshake:     true,
    });
    _allMessages.sort((a, b) => a.timestamp - b.timestamp);
    saveMessages();
  }

  renderConversations();
  renderChat();
}



async function sendGroupMessage(conversationId, text, readyEnvelope = null) {
  const group = getGroup(conversationId);
  if (!group) return;

  if (group.type === 'channel' && !group.is_owner) return;

  const ts    = Math.floor(Date.now() / 1000);
  const msgId = 'msg-' + uuidv4();

  let envelopeStr;
  let previewText;

  if (readyEnvelope) {

    envelopeStr = JSON.stringify(readyEnvelope);
    previewText = readyEnvelope.body?.caption || readyEnvelope.body?.filename || t('group.filePreview','📎 file');
  } else {
    const envelopeBase = {
      type:            'message',
      from:            _address,
      conversation_id: conversationId,
      message_id:      msgId,
      timestamp:       ts,
      roster_version:  group.roster_version,
      body:            { text },
    };
    const signature = await signEnvelope(JSON.stringify(envelopeBase));
    envelopeStr = JSON.stringify({ ...envelopeBase, signature });
    previewText = text || '';
  }

  // Encryptgroup_key
  const encrypted = await encryptWithGroupKey(group.group_key, envelopeStr);


  const roster = [_address, ...group.roster.filter(a => a !== _address)];


  await authedFetch(`${SERVER_URL}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message_id:      msgId,
      to:              roster,
      timestamp:       ts,
      conversation_id: conversationId,
      payload:         encrypted,
    }),
  });


  touchConversation(conversationId, null, previewText, ts);
  renderConversations();
}


async function handleGroupMessage(msg) {

  if (!msg.conversation_id || !msg.payload) return false;
  const group = getGroup(msg.conversation_id);
  if (!group) return false;

  if (_seenIds.has(msg.message_id)) return true;
  _seenIds.add(msg.message_id);

  if (msg.server_ts && msg.server_ts > _lastServerTimestamp) {
    _lastServerTimestamp = msg.server_ts;
    saveMessages();
  }

  let envelope;
  try {
    envelope = await decryptWithGroupKey(group.group_key, msg.payload);
  } catch {
    return false;
  }

  if (!envelope?.conversation_id || envelope.conversation_id !== group.conversation_id) return false;

  const isMine   = envelope.from === _address;
  const contacts = loadContacts();
  const sender   = contacts.find(c => c.address === envelope.from);


  if (!isMine && sender?.signPubKeyB64 && envelope.signature) {
    const { signature, ...base } = envelope;
    const valid = await verifyEnvelope(JSON.stringify(base), signature, sender.signPubKeyB64);
    if (!valid) {
      _allMessages.push({
        message_id:      msg.message_id,
        timestamp:       msg.timestamp,
        conversation_id: group.conversation_id,
        body:            t('group.invalidSignature','⚠️ Invalid group signature!'),
        isMine:          false,
        isWarning:       true,
        displayName:     '⚠️',
      });
      _allMessages.sort((a, b) => a.timestamp - b.timestamp);
      saveMessages();
      renderChat();
      return true;
    }
  }


  const msgType = envelope.type || 'message';
  let bodyText;
  let fileMeta = null;

  if (msgType === 'message') {
    bodyText = envelope.body?.text || '';
  } else if (msgType === 'file') {
    fileMeta = envelope.body || {};
    bodyText  = fileMeta.caption || '';
  } else if (msgType === 'location') {
    bodyText = envelope.body?.caption || '';
  } else if (msgType === 'reaction') {
    handleIncomingReaction(envelope);
    return true;
  } else {
    return true;
  }

  const fromName    = sender?.name || (envelope.from.slice(0, 4) + '…' + envelope.from.slice(-4));
  const displayName = isMine ? t('group.senderYou','📤 You') : '👤 ' + escapeHtml(fromName);

  _allMessages.push({
    message_id:      msg.message_id,
    timestamp:       msg.timestamp,
    conversation_id: group.conversation_id,
    from:            envelope.from,
    body:            bodyText,
    type:            msgType,
    fileMeta,
    locationMeta:    msgType === 'location' ? envelope.body : null,
    isMine,
    displayName,
  });
  _allMessages.sort((a, b) => a.timestamp - b.timestamp);
  touchConversation(group.conversation_id, null, bodyText, msg.timestamp);
  saveMessages();

  if (!isMine && group.conversation_id !== _activeConvId) {
    _unreadCounts[group.conversation_id] = (_unreadCounts[group.conversation_id] || 0) + 1;
    saveUnreadCounts();
  }




  renderConversations();
  renderChat();
  return true;
}
