// ─── Chat maps manager (KartaJS)KartaJS ────────────────────────────────────────────
const _chatMaps = {}; // mapId → KartaJS instance

function _destroyAllChatMaps() {
  for (const id of Object.keys(_chatMaps)) {
    try { _chatMaps[id].destroy(); } catch {}
    delete _chatMaps[id];
  }
}

function _initOneChatMap(el) {
  if (_chatMaps[el.id]) return;
  const lat = parseFloat(el.dataset.lat);
  const lng = parseFloat(el.dataset.lng);
  if (isNaN(lat) || isNaN(lng)) return;

  // Ensure container has non-zero width
  const rect = el.getBoundingClientRect();
  if (rect.width === 0) {
    // Wait for browser to render containerResizeObserver
    const ro = new ResizeObserver((entries, observer) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          observer.disconnect();
          _initOneChatMap(el);
        }
      }
    });
    ro.observe(el);
    return;
  }

  const latDir   = lat >= 0 ? 'N' : 'S';
  const lngDir   = lng >= 0 ? 'E' : 'W';
  const coordTxt = `${latDir}${Math.abs(lat).toFixed(5)} ${lngDir}${Math.abs(lng).toFixed(5)}`;
  const map = new KartaJS(el.id, {
    zoom: 14, center: [lat, lng],
    markers: [{ lat, lng, title: coordTxt, popup: coordTxt }],
  });
  _chatMaps[el.id] = map;
}

function _initChatMaps() {
  document.querySelectorAll('.location-map-bubble').forEach(el => _initOneChatMap(el));
}

// ─── Auto-scroll on content growth────────────────
let _inboxResizeObserver = null;
let _inboxShouldStickToBottom = true;

function _setupInboxScrollObserver() {
  const inbox = document.getElementById('inbox');
  if (!inbox) return;

  // Track manual scroll
  inbox.addEventListener('scroll', () => {
    const distFromBottom = inbox.scrollHeight - inbox.scrollTop - inbox.clientHeight;
    _inboxShouldStickToBottom = distFromBottom < 60;


    if (inbox.scrollTop === 0) {
      const allForConv = _activeConvId
        ? _allMessages.filter(m =>
            m.conversation_id === _activeConvId &&
            !(m.isHandshake && !isShowSystemMessages()))
        : [];
      if (allForConv.length > _chatPageSize) {
        _chatPageSize += 20;
        renderChat({ keepScroll: true });
      }
    }
  }, { passive: true });




  if (_inboxResizeObserver) _inboxResizeObserver.disconnect();
  _inboxResizeObserver = new ResizeObserver(() => {
    if (_inboxShouldStickToBottom) {
      _scrollToBottom();
    }
  });



  const firstChild = inbox.firstElementChild;
  if (firstChild) _inboxResizeObserver.observe(firstChild);
}

// CalledrenderChat() — ResizeObserver
function _reobserveInbox() {
  if (!_inboxResizeObserver) return;
  _inboxResizeObserver.disconnect();
  const inbox = document.getElementById('inbox');
  if (!inbox) return;

  for (const child of inbox.children) {
    _inboxResizeObserver.observe(child);
  }
}



function _scrollToBottom() {
  const anchor = document.getElementById('inbox-bottom');
  if (anchor) anchor.scrollIntoView({ block: 'end' });
}


function renderChat({ keepScroll = false } = {}) {
  const inbox = document.getElementById('inbox');


  _destroyAllChatMaps();

  // Rememberid —

  let anchorId = null;
  if (keepScroll) {
    const msgs = inbox.querySelectorAll('.msg[id]');
    for (const el of msgs) {
      if (el.getBoundingClientRect().top >= inbox.getBoundingClientRect().top) {
        anchorId = el.id;
        break;
      }
    }
  }


  const allForConv = _activeConvId
    ? _allMessages.filter(m =>
        m.conversation_id === _activeConvId &&
        !(m.isHandshake && !isShowSystemMessages()))
    : [];

  inbox.innerHTML = '<div id="inbox-spacer"></div>';

  if (!allForConv.length) {
    inbox.innerHTML = '<div id="inbox-spacer"></div><div class="inbox-empty">' +
      (_activeConvId ? t('chat.empty','no messages yet') : t('chat.selectConversation','select a conversation')) + '</div>';
    return;
  }

  // Lazy loading: take last _chatPageSize messages_chatPageSize
  const hasMore  = allForConv.length > _chatPageSize;
  const messages = hasMore ? allForConv.slice(allForConv.length - _chatPageSize) : allForConv;

  // Indicator: more messages above
  if (hasMore) {
    const indicator = document.createElement('div');
    indicator.className = 'chat-load-more';
    indicator.textContent = `↑ ${allForConv.length - _chatPageSize} ${t('chat.moreMessages','more')}`;
    inbox.appendChild(indicator);
  }

  const isGroup  = !!(_activeConvId && getGroup(_activeConvId));
  const contacts = loadContacts();
  let lastFrom   = null;


  for (const m of messages) {
    const d       = document.createElement('div');
    const msgDate = new Date(m.timestamp * 1000);
    const now     = new Date();
    const isToday = msgDate.toDateString() === now.toDateString();
    const ts = isToday
      ? msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : msgDate.toLocaleDateString() + ' ' + msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (m.isHandshake) {
      d.id        = m.message_id;
      d.className = 'msg';
      d.innerHTML = `<div class="msg-payload">${escapeHtml(m.body)}</div><div class="msg-meta">${escapeHtml(ts)}</div>`;
      lastFrom = null;
    } else if (m.isWarning) {
      d.className = 'msg msg-warning';
      d.innerHTML = `<div class="msg-payload">${escapeHtml(m.body)}</div><div class="msg-meta">${escapeHtml(ts)}</div>`;
      lastFrom = null;
    } else {
      const isFirstInRow = m.isMine ? (lastFrom !== '__me__') : (m.from !== lastFrom);
      d.id        = m.message_id;
      d.className = 'msg ' + (m.isMine ? 'msg-right' : 'msg-left') + (isFirstInRow ? '' : ' msg-grouped');


      let senderHeader = '';
      if (isGroup && !m.isMine && m.from) {
        if (isFirstInRow) {
          const contact   = contacts.find(c => c.address === m.from);
          const fromName  = contact?.name || `${m.from.slice(0,4)}…${m.from.slice(-4)}`;
          const avatar    = generateIdenticon(m.from, 22);
          senderHeader = `<div class="msg-sender">` +
            `<img src="${avatar}" width="22" height="22" alt="" class="avatar-xs">` +
            `<span>${escapeHtml(fromName)}</span>` +
            `</div>`;
        }
      }

      let contentHtml;
      let fileExpiryStr = '';
      if (m.type === 'file' && m.fileMeta) {
        const bubble = renderFileBubble(m.fileMeta, m.message_id);
        contentHtml   = bubble.html;
        fileExpiryStr = bubble.expiryStr;
      } else if (m.type === 'location' && m.locationMeta) {
        const mapId = 'map-' + m.message_id;
        const lat   = escapeHtml(String(m.locationMeta.lat));
        const lng   = escapeHtml(String(m.locationMeta.lng));
        const cap   = m.locationMeta.caption ? `<div class="msg-payload">${escapeHtml(m.locationMeta.caption)}</div>` : '';
        contentHtml = `${cap}<div class="location-map-bubble" id="${mapId}" data-lat="${lat}" data-lng="${lng}" style="width:100%;height:300px;border-radius:8px;overflow:hidden;"></div>`;
      } else {
        contentHtml = `<div class="msg-payload md-body">${renderMarkdown(m.body)}</div>`;
      }


      const msgReactions = _reactions[m.message_id] || {};
      let reactionsHtml  = '';
      for (const [emoji, addrs] of Object.entries(msgReactions)) {
        if (!addrs.length) continue;
        const iMine    = addrs.includes(_address);
        const tipNames = addrs.map(a => {
          if (a === _address) return t('you','You');
          const c = loadContacts().find(x => x.address === a);
          return c?.name || (a.slice(0,4) + '…' + a.slice(-4));
        }).join(', ');
        reactionsHtml += `<button class="reaction-pill${iMine ? ' reaction-mine' : ''}" ` +
          `title="${escapeHtml(tipNames)}" ` +
          `onclick="toggleReaction(event,'${escapeHtml(m.message_id)}','${emoji}')">` +
          `${emoji} ${addrs.length}</button>`;
      }
      const addBtn = `<button class="reaction-add" title="${t('reaction.add','Add reaction')}" ` +
        `onclick="openReactionPicker(event,'${escapeHtml(m.message_id)}')">😊</button>`;


      const metaTs = fileExpiryStr
        ? `${escapeHtml(fileExpiryStr)} <span class="msg-meta-sep">|</span> ${escapeHtml(ts)}`
        : escapeHtml(ts);


      const footer = `<div class="msg-footer">` +
        `<div class="msg-reactions">${reactionsHtml}${addBtn}</div>` +
        `<div class="msg-meta">${metaTs}</div>` +
      `</div>`;

      d.innerHTML = senderHeader + contentHtml + footer;

      lastFrom = m.isMine ? '__me__' : (m.from || null);
    }
    inbox.appendChild(d);
  }


  const bottomAnchor = document.createElement('div');
  bottomAnchor.id = 'inbox-bottom';
  inbox.appendChild(bottomAnchor);

  _reobserveInbox();

  if (keepScroll && anchorId) {

    const anchor = document.getElementById(anchorId);
    if (anchor) anchor.scrollIntoView({ block: 'start' });
    _inboxShouldStickToBottom = false;
  } else {

    _inboxShouldStickToBottom = true;
    _scrollToBottom();
  }



  setTimeout(_initChatMaps, 150);
}


const REACTION_EMOJIS = ['👍','👎', '👀', '❤️','😂','😮','😢','🔥','👏','🤘','🎉','😡','🤡','💩'];

function openReactionPicker(event, msgId) {
  event.stopPropagation();

  closeReactionPicker();

  const picker = document.createElement('div');
  picker.id        = 'reaction-picker';
  picker.className = 'reaction-picker-popup';
  picker.innerHTML = REACTION_EMOJIS.map(e =>
    `<button onclick="pickReaction(event,'${msgId}','${e}')">${e}</button>`
  ).join('');

  document.body.appendChild(picker);


  const rect = event.currentTarget.getBoundingClientRect();
  picker.style.top  = (rect.top + window.scrollY - picker.offsetHeight - 8) + 'px';
  picker.style.left = (rect.left + window.scrollX) + 'px';


  requestAnimationFrame(() => {
    const ph = picker.offsetHeight || 48;
    picker.style.top  = (rect.top + window.scrollY - ph - 8) + 'px';
    picker.style.left = Math.min(
      rect.left + window.scrollX,
      window.innerWidth - picker.offsetWidth - 8
    ) + 'px';
  });

  // Close
  setTimeout(() => document.addEventListener('click', closeReactionPicker, { once: true }), 0);
}

function closeReactionPicker() {
  const p = document.getElementById('reaction-picker');
  if (p) p.remove();
}

function pickReaction(event, msgId, emoji) {
  event.stopPropagation();
  closeReactionPicker();
  toggleReaction(event, msgId, emoji);
}


function toggleReaction(event, msgId, emoji) {
  event.stopPropagation();
  const myAddrs  = (_reactions[msgId] && _reactions[msgId][emoji]) || [];
  const iAlready = myAddrs.includes(_address);
  sendReaction(msgId, emoji, iAlready ? 'remove' : 'add');
}


// CalledrenderChat() /
function renderReactions(msgId) {
  const d = document.getElementById(msgId);
  if (!d) return;

  let reactionsBlock = d.querySelector('.msg-reactions');
  if (!reactionsBlock) return;

  const msgReactions = _reactions[msgId] || {};
  let reactionsHtml  = '';
  for (const [emoji, addrs] of Object.entries(msgReactions)) {
    if (!addrs.length) continue;
    const iMine    = addrs.includes(_address);
    const tipNames = addrs.map(a => {
      if (a === _address) return t('you','You');
      const c = loadContacts().find(x => x.address === a);
      return c?.name || (a.slice(0,4) + '…' + a.slice(-4));
    }).join(', ');
    reactionsHtml += `<button class="reaction-pill${iMine ? ' reaction-mine' : ''}" ` +
      `title="${escapeHtml(tipNames)}" ` +
      `onclick="toggleReaction(event,'${escapeHtml(msgId)}','${emoji}')">` +
      `${emoji} ${addrs.length}</button>`;
  }
  const addBtn = `<button class="reaction-add" title="${t('reaction.add','Add reaction')}" ` +
    `onclick="openReactionPicker(event,'${escapeHtml(msgId)}')">😊</button>`;

  reactionsBlock.innerHTML = reactionsHtml + addBtn;
}


function updateChatHeader(name, address, group = null) {
  const header = document.getElementById('chat-header');
  Array.from(header.children).forEach(el => {
    if (el.id !== 'btn-back') el.remove();
  });

  if (!address) {
    const status = document.createElement('div');
    status.id = 'inbox-status';
    status.textContent = t('waiting','waiting…');
    header.appendChild(status);
    return;
  }

  const avatar = generateIdenticon(address, 36);
  const img = document.createElement('img');
  img.src = avatar; img.alt = escapeHtml(name);
  img.width = 36; img.height = 36;
  img.className = 'chat-header-avatar';

  const typeIcon = group?.type === 'channel' ? '📢 ' : group?.type === 'group' ? '👥 ' : '';
  const info = document.createElement('div');
  info.className = 'chat-header-info';
  info.innerHTML =
    `<div id="chat-header-name">${typeIcon}${escapeHtml(name)}</div>` +
    `<div id="inbox-status">${t('waiting','waiting…')}</div>`;

  header.appendChild(img);
  header.appendChild(info);


  if (group) {
    const membersBtn = document.createElement('button');
    membersBtn.title = t('menu.members','Members');
    membersBtn.textContent = `👥 ${group.roster.length}`;
    membersBtn.className = 'btn-group-members';
    membersBtn.onclick = () => openGroupMembers(group.conversation_id);
    header.appendChild(membersBtn);
  }


  const convId    = _activeConvId;
  const isDirect  = !group;
  const peerAddr  = isDirect ? address : null;

  const menuBtn = document.createElement('button');
  menuBtn.className = 'btn-conv-menu';
  menuBtn.title     = t('menu.title','Conversation menu');
  menuBtn.textContent = '☰';
  menuBtn.onclick = (e) => { e.stopPropagation(); openConvMenu(convId, peerAddr, menuBtn); };
  header.appendChild(menuBtn);
}


function openConvMenu(convId, peerAddr, anchor) {
  // Close
  closeConvMenu();

  const convs = loadConversations();
  const conv  = convs.find(c => c.conversation_id === convId);
  const folder = conv?.folder || null;

  const menu = document.createElement('div');
  menu.id        = 'conv-menu-popup';
  menu.className = 'conv-menu-popup';

  const items = [];


  const group = getGroup(convId);
  if (peerAddr) {
    items.push({ icon: '✏️', label: t('menu.renameContact','Rename contact'), action: () => openRenameContact(peerAddr) });
  } else if (group) {
    items.push({ icon: '✏️', label: t('menu.renameChat','Rename chat'), action: () => openRenameGroup(convId) });
  }


  if (peerAddr) {
    items.push({ icon: '🔗', label: t('menu.copyLink','Copy contact link'), action: () => {
      const name = loadContacts().find(c => c.address === peerAddr)?.name || '';
      const url  = location.origin + '/add.html?addr=' + encodeURIComponent(peerAddr) +
                   (name ? '&name=' + encodeURIComponent(name) : '');
      navigator.clipboard.writeText(url).then(() => {
        _showConvMenuToast(t('menu.linkCopied','✅ Link copied'));
      }).catch(() => prompt(t('menu.copyPrompt','Copy link:'), url));
    }});
  }


  if (folder === 'starred') {
    items.push({ icon: '✦', label: t('menu.unstarred','Remove from favorites'), action: () => {
      setConversationFolder(convId, null);
      renderConversations();
    }});
  } else {
    items.push({ icon: '⭐', label: t('menu.starred','Add to favorites'), action: () => {
      setConversationFolder(convId, 'starred');
      renderConversations();
    }});
  }


  if (folder === 'archived') {
    items.push({ icon: '📤', label: t('menu.unarchive','From archive'), action: () => {
      setConversationFolder(convId, null);
      renderConversations();
    }});
  } else {
    items.push({ icon: '📁', label: t('menu.archive','To archive'), action: () => {
      setConversationFolder(convId, 'archived');
      renderConversations();
    }});
  }

  menu.innerHTML = items.map((item, i) =>
    `<div class="conv-menu-item" data-idx="${i}">${item.icon} ${escapeHtml(item.label)}</div>`
  ).join('');

  menu.querySelectorAll('.conv-menu-item').forEach((el, i) => {
    el.onclick = (e) => { e.stopPropagation(); closeConvMenu(); items[i].action(); };
  });

  document.body.appendChild(menu);


  const rect = anchor.getBoundingClientRect();
  menu.style.top   = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';

  // Close
  setTimeout(() => document.addEventListener('click', closeConvMenu, { once: true }), 0);
}

function closeConvMenu() {
  const m = document.getElementById('conv-menu-popup');
  if (m) m.remove();
}

function _showConvMenuToast(text) {
  const t = document.createElement('div');
  t.className   = 'conv-menu-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}


function inlineRenameContact(btn, address) {
  const row     = btn.closest('.contacts-popup-item');
  const nameDiv = row.querySelector('.contacts-popup-item-name');
  if (!nameDiv) return;

  const contacts = loadContacts();
  const contact  = contacts.find(c => c.address === address);
  if (!contact) return;


  const input = document.createElement('input');
  input.className = 'inline-rename-input';
  input.value     = contact.name || '';
  input.maxLength = 64;
  input.placeholder = t('contact.namePlaceholder','Contact name');
  nameDiv.textContent = '';
  nameDiv.appendChild(input);


  btn.textContent = '✓';
  btn.title       = t('save','Save');
  btn.className   = 'btn-contact-edit btn-contact-save';
  btn.onclick     = (e) => { e.stopPropagation(); _saveInlineRename(input, address); };

  input.focus();
  input.select();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); _saveInlineRename(input, address); }
    if (e.key === 'Escape') { renderContactsInPopup(); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

function _saveInlineRename(input, address) {
  const newName = sanitizeName(input.value.trim());

  const contacts = loadContacts();
  const contact  = contacts.find(c => c.address === address);
  if (contact) {
    contact.name = newName;
    saveContacts(contacts);
    syncContactToServer(contact);

    // Update
    const convs = loadConversations();
    const conv  = convs.find(c => c.peerAddress === address);
    if (conv && newName) { conv.name = newName; saveConversations(convs); }
  }

  renderContactsInPopup();
  renderConversations();

  // Update
  if (_activeConvId) {
    const convs   = loadConversations();
    const conv    = convs.find(c => c.conversation_id === _activeConvId);
    if (conv?.peerAddress === address) {
      const group = getGroup(_activeConvId);
      const name  = contact?.name || (address ? `${address.slice(0,4)}…${address.slice(-4)}` : '');
      updateChatHeader(name, address, group);
    }
  }
}


function openRenameContact(address) {
  const contacts = loadContacts();
  const contact  = contacts.find(c => c.address === address);
  if (!contact) return;

  const modal = document.getElementById('modal-rename');
  document.getElementById('rename-title').textContent = t('menu.renameContact','Rename contact');
  const input = document.getElementById('rename-input');
  input.value = contact.name || '';
  input.placeholder = t('contact.namePlaceholder','Contact name');
  modal.dataset.target = 'contact';
  modal.dataset.address = address;
  modal.classList.add('show');
  setTimeout(() => input.focus(), 50);
}

function openRenameGroup(conversationId) {
  const group = getGroup(conversationId);
  if (!group) return;

  const modal = document.getElementById('modal-rename');
  document.getElementById('rename-title').textContent = t('menu.renameChat','Rename chat');
  const input = document.getElementById('rename-input');
  input.value = group.topic || '';
  input.placeholder = t('rename.chatPlaceholder','Chat name');
  modal.dataset.target = 'group';
  modal.dataset.convId = conversationId;
  modal.classList.add('show');
  setTimeout(() => input.focus(), 50);
}

function closeRenameModal() {
  document.getElementById('modal-rename').classList.remove('show');
}

async function confirmRename() {
  const modal  = document.getElementById('modal-rename');
  const input  = document.getElementById('rename-input');
  const newName = sanitizeName(input.value.trim());
  if (!newName) return;

  const target = modal.dataset.target;

  if (target === 'contact') {
    const address  = modal.dataset.address;
    const contacts = loadContacts();
    const contact  = contacts.find(c => c.address === address);
    if (contact) {
      contact.name = newName;
      saveContacts(contacts);
      syncContactToServer(contact);

      // Update
      const convs = loadConversations();
      const conv  = convs.find(c => c.peerAddress === address);
      if (conv) { conv.name = newName; saveConversations(convs); }
    }
  } else if (target === 'group') {
    const convId = modal.dataset.convId;
    const group  = getGroup(convId);
    if (group) {
      group.topic = newName;
      saveGroup(group);

      // Update
      const convs = loadConversations();
      const conv  = convs.find(c => c.conversation_id === convId);
      if (conv) { conv.name = newName; saveConversations(convs); }
    }
  }

  closeRenameModal();
  renderConversations();

  // Update
  if (_activeConvId) {
    const group   = getGroup(_activeConvId);
    const convs   = loadConversations();
    const conv    = convs.find(c => c.conversation_id === _activeConvId);
    const contact = conv?.peerAddress ? loadContacts().find(c => c.address === conv.peerAddress) : null;
    const name    = group?.topic || contact?.name || conv?.name ||
      (conv?.peerAddress ? `${conv.peerAddress.slice(0,4)}…${conv.peerAddress.slice(-4)}` : '');
    updateChatHeader(name, conv?.peerAddress || _activeConvId, group);
  }

  // Update
  renderContactsInPopup();
}


let _archiveExpanded = false;

function renderConversations() {
  const list     = document.getElementById('contact-list');
  const contacts = loadContacts();

  const convs = loadConversations().filter(conv => {
    if (!conv.peerAddress) return true;
    const contact = contacts.find(c => c.address === conv.peerAddress);
    if (!contact) return false;
    if (contact.status === 'blocked') return false;
    return true;
  });

  if (!convs.length) {
    list.innerHTML = '<div class="conv-list-empty">' + t('sidebar.noConversations','no conversations yet') + '</div>';
    return;
  }


  const starred  = convs.filter(c => c.folder === 'starred');
  const normal   = convs.filter(c => !c.folder || c.folder === 'default');
  const archived = convs.filter(c => c.folder === 'archived');

  list.innerHTML = '';

  const renderConvItem = (conv) => {
    const group    = getGroup(conv.conversation_id);
    const contact  = conv.peerAddress ? contacts.find(c => c.address === conv.peerAddress) : null;
    const name     = group?.topic || conv.name || contact?.name ||
      (conv.peerAddress ? `${conv.peerAddress.slice(0,4)}…${conv.peerAddress.slice(-4)}` : conv.conversation_id.slice(0, 8) + '…');
    const typeIcon = conv.type === 'channel' ? '📢 ' : conv.type === 'group' ? '👥 ' : '';
    const starIcon = conv.folder === 'starred' ? '<span class="conv-star">⭐</span>' : '';
    const unread   = _unreadCounts[conv.conversation_id] || 0;
    const unreadBadge = unread > 0 ? `<span class="contact-unread">${unread}</span>` : '';
    const avatarAddr  = conv.peerAddress || conv.conversation_id;
    const preview  = conv.lastMessage
      ? escapeHtml(conv.lastMessage.length > 35 ? conv.lastMessage.slice(0, 35) + '…' : conv.lastMessage)
      : '';
    const msgDate  = conv.lastTs ? new Date(conv.lastTs * 1000) : null;
    const now      = new Date();
    let tsStr = '';
    if (msgDate) {
      tsStr = msgDate.toDateString() === now.toDateString()
        ? msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : msgDate.toLocaleDateString([], { day: 'numeric', month: 'short' });
    }
    const isActive = conv.conversation_id === _activeConvId;
    const el = document.createElement('div');
    el.className = 'contact-item' + (isActive ? ' active' : '');
    el.dataset.convId = conv.conversation_id;
    el.innerHTML =
      `<img src="${generateIdenticon(avatarAddr, 32)}" alt="" width="32" height="32" class="avatar-sm">` +
      `<div class="conv-inner">` +
        `<div class="conv-row-top">` +
          `<span class="conv-name">${typeIcon}${escapeHtml(name)}${starIcon}</span>` +
          `<span class="conv-ts">${tsStr}</span>` +
        `</div>` +
        `<div class="conv-row-bottom">` +
          `<span>${preview}</span>${unreadBadge}` +
        `</div>` +
      `</div>`;
    el.onclick = () => openConversation(conv.conversation_id, conv.peerAddress);
    return el;
  };


  if (starred.length) {
    starred.forEach(c => list.appendChild(renderConvItem(c)));

    if (normal.length || archived.length) {
      const div = document.createElement('div');
      div.className = 'conv-folder-divider';
      list.appendChild(div);
    }
  }


  normal.forEach(c => list.appendChild(renderConvItem(c)));


  if (archived.length) {
    const archiveHeader = document.createElement('div');
    archiveHeader.className = 'conv-folder-sep conv-folder-archive';
    archiveHeader.innerHTML =
      `<span>${_archiveExpanded ? '▾' : '▸'} ${t('sidebar.archive','Archive')} (${archived.length})</span>`;
    archiveHeader.onclick = () => {
      _archiveExpanded = !_archiveExpanded;
      renderConversations();
    };
    list.appendChild(archiveHeader);

    if (_archiveExpanded) {
      archived.forEach(c => list.appendChild(renderConvItem(c)));
    }
  }
}


async function openConversation(conversationId, peerAddress) {
  // Save
  const payloadEl = document.getElementById('payload');
  if (payloadEl && _activeConvId && _activeConvId !== conversationId) {
    const draft = payloadEl.value;
    if (draft.trim()) {
      _drafts[_activeConvId] = draft;
    } else {
      delete _drafts[_activeConvId];
    }
  }


  if (_unreadCounts[conversationId]) {
    delete _unreadCounts[conversationId];
    saveUnreadCounts();
  }

  _activeConvId = conversationId;
  _chatPageSize = 20;
  _destroyAllChatMaps();
  localStorage.setItem('screw-last-conv-id', conversationId);


  if (!peerAddress && !getGroup(conversationId)) {
    const contacts = loadContacts();
    for (const c of contacts) {
      if (!c.address) continue;
      try {
        const cid = await personalConversationId(_address, c.address);
        if (cid === conversationId) {
          peerAddress = c.address;
          // Save
          touchConversation(conversationId, peerAddress, null, 0);
          break;
        }
      } catch {}
    }
  }

  // Find
  const contacts = loadContacts();
  const group    = getGroup(conversationId);
  const contact  = contacts.find(c => c.address === peerAddress);
  const name     = group?.topic || contact?.name ||
    (peerAddress ? `${peerAddress.slice(0,4)}…${peerAddress.slice(-4)}` : conversationId.slice(0,8) + '…');

  document.getElementById('to').value = peerAddress || '';

  const sendArea  = document.getElementById('send-area');
  const noKeyNote = document.getElementById('no-key-notice');

  if (group) {

    if (group.type === 'channel' && !group.is_owner) {
      sendArea.style.display  = 'none';
      noKeyNote.style.display = '';
      noKeyNote.textContent   = t('chat.channelReadonly','📢 This is a channel — only the owner can post.');
    } else {
      sendArea.style.display  = '';
      noKeyNote.style.display = 'none';
    }
  } else if (!peerAddress || !contact || !contact.pubKeyB64 || contact.status === 'pending') {
    sendArea.style.display  = 'none';
    noKeyNote.style.display = '';
    noKeyNote.textContent   = contact?.status === 'pending'
      ? t('chat.awaitHandshake','⏳ Waiting for handshake response…')
      : t('chat.noKeyWarning','⚠ Public key unknown — sending disabled.');
  } else {
    sendArea.style.display  = '';
    noKeyNote.style.display = 'none';
  }

  updateChatHeader(name, peerAddress || conversationId, group);
  renderConversations();

  if (!document.body.classList.contains('mobile-chat')) {
    history.pushState({ screwChat: true }, '');
  }
  document.body.classList.add('mobile-chat');

  // Restore
  if (payloadEl) {
    payloadEl.value = _drafts[conversationId] || '';
    if (typeof autoResizePayload === 'function') autoResizePayload();
    if (sendArea.style.display !== 'none' && !isTouchDevice()) payloadEl.focus();
  }

  renderChat();
}


function renderContactsInPopup() {
  const list     = document.getElementById('contacts-popup-list');
  if (!list) return;

  const allContacts = loadContacts();
  const active   = allContacts.filter(c => c.status !== 'blocked');
  const blocked  = allContacts.filter(c => c.status === 'blocked');

  list.innerHTML = '';


  if (!active.length) {
    list.innerHTML = '<div class="contacts-popup-empty">' + t('contact.noContacts','no contacts yet') + '</div>';
  } else {
    active.forEach(c => {
      const realIdx = allContacts.indexOf(c);
      let badge = '';
      if (c.status === 'unknown') badge = '<span class="contact-badge-new">new</span>';
      if (c.status === 'pending') badge = '<span class="contact-badge-pending">⏳</span>';

      const displayName = c.name
        ? escapeHtml(c.name)
        : `${escapeHtml(c.address.slice(0, 4))}…${escapeHtml(c.address.slice(-4))}`;

      const el = document.createElement('div');
      el.className = 'contact-item contacts-popup-item';
      el.innerHTML =
        `<img src="${generateIdenticon(c.address, 32)}" alt="" width="32" height="32" class="avatar-sm">` +
        `<div class="contacts-popup-item-name">${displayName} ${badge}</div>` +
        `<div class="contacts-popup-item-actions">` +
          `<button onclick="event.stopPropagation(); inlineRenameContact(this, '${c.address}')" title="${t('contact.rename','Rename')}" class="btn-contact-edit">✏️</button>` +
          (c.pubKeyB64
            ? `<button onclick="event.stopPropagation(); startConvWithContact(${realIdx})" class="btn-contact-msg">◥</button>`
            : `<button onclick="event.stopPropagation(); retryHandshake('${c.address}')" class="btn-contact-retry">↺</button>`) +
          `<button onclick="event.stopPropagation(); blockContactByAddress('${c.address}')" title="${t('contact.block','Block')}" class="btn-contact-block">🚫</button>` +
        `</div>`;
      el.onclick = e => { if (!e.target.closest('button')) startConvWithContact(realIdx); };
      list.appendChild(el);
    });
  }


  if (blocked.length) {
    const sep = document.createElement('div');
    sep.className = 'contacts-blocked-sep';
    sep.textContent = `${t('contact.blocked','Blocked')} (${blocked.length})`;
    list.appendChild(sep);

    blocked.forEach(c => {
      const displayName = c.name
        ? escapeHtml(c.name)
        : `${escapeHtml(c.address.slice(0, 4))}…${escapeHtml(c.address.slice(-4))}`;

      const el = document.createElement('div');
      el.className = 'contacts-blocked-item';
      el.innerHTML =
        `<img src="${generateIdenticon(c.address, 32)}" alt="" width="32" height="32" class="avatar-sm">` +
        `<div class="contacts-blocked-item-name">${displayName}</div>` +
        `<div class="contacts-blocked-item-actions">` +
          `<button onclick="unblockContact('${c.address}')" title="${t('contact.unblock','Unblock')}" class="btn-contact-unblock">✓</button>` +
          `<button onclick="forgetContactByAddress('${c.address}')" title="${t('delete','Delete')}" class="btn-contact-forget">🗑</button>` +
        `</div>`;
      list.appendChild(el);
    });
  }
}

function openContactsPopup() {
  renderContactsInPopup();
  document.getElementById('modal-contacts-popup').classList.add('show');
}
function closeContactsPopup() {
  document.getElementById('modal-contacts-popup').classList.remove('show');
}

async function startConvWithContact(idx) {
  closeContactsPopup();
  const contacts = loadContacts();
  const c = contacts[idx];
  if (!c || c.status === 'blocked') return;

  const convId = await personalConversationId(_address, c.address);


  const convs = loadConversations();
  if (!convs.find(cv => cv.conversation_id === convId)) {
    convs.unshift({ conversation_id: convId, type: 'direct', peerAddress: c.address, lastTs: 0 });
    saveConversations(convs);
  }

  await openConversation(convId, c.address);
}


function renderContacts() {
  renderConversations();
}


function backToContacts() {
  document.body.classList.remove('mobile-chat');
  if (history.state && history.state.screwChat) {
    history.back();
  }
}






if (window.visualViewport) {
  const onViewportChange = () => {
    const main = document.getElementById('main');
    if (!main) return;
    main.style.top    = window.visualViewport.offsetTop + 'px';
    main.style.height = window.visualViewport.height + 'px';
    main.style.bottom = 'auto';



    if (inbox) _scrollToBottom();
  };

  window.visualViewport.addEventListener('resize', onViewportChange);
  window.visualViewport.addEventListener('scroll', onViewportChange);
}


window.addEventListener('popstate', function() {
  if (document.body.classList.contains('mobile-chat')) {
    document.body.classList.remove('mobile-chat');
  }
});






async function restoreLastContact() {
  const params    = new URLSearchParams(location.search);
  const msgParam  = params.get('msg');
  const convParam = params.get('conv');


  if (msgParam) {
    await fetchInbox();
    const found = _allMessages.find(m => m.message_id === msgParam);
    if (found && found.conversation_id) {
      return await _openConversationById(found.conversation_id);
    }
    console.warn('[restore] msg not found locally:', msgParam);
  }


  if (convParam) {
    return await _openConversationById(convParam);
  }


  const lastConvId = localStorage.getItem('screw-last-conv-id');
  if (lastConvId) {
    return await _openConversationById(lastConvId);
  }

  document.getElementById('inbox').innerHTML = '<div class="inbox-empty">' + t('chat.selectConversation','select a conversation') + '</div>';
}


async function _openConversationById(convId) {

  const convs = loadConversations();
  const conv  = convs.find(c => c.conversation_id === convId);
  if (conv) {
    await openConversation(conv.conversation_id, conv.peerAddress);
    return;
  }

  const contacts = loadContacts();
  for (const c of contacts) {
    if (c.status === 'blocked') continue;
    try {
      const cid = await personalConversationId(_address, c.address);
      if (cid === convId) {
        await openConversation(convId, c.address);
        return;
      }
    } catch {}
  }

  _activeConvId = convId;
  renderChat();
}


function notifyNewContact() {
  _newContactsCount++;
  const badge = document.getElementById('contacts-badge');
  badge.textContent = _newContactsCount;
  badge.style.display = 'inline';
  if (!_titleBlinkInterval) {
    const orig = document.title;
    let blink = false;
    _titleBlinkInterval = setInterval(() => {
      document.title = blink ? `(${_newContactsCount}) New contact — Screw` : orig;
      blink = !blink;
    }, 1000);
  }
}

function clearNewContactsBadge() {
  _newContactsCount = 0;
  document.getElementById('contacts-badge').style.display = 'none';
  if (_titleBlinkInterval) {
    clearInterval(_titleBlinkInterval);
    _titleBlinkInterval = null;
    document.title = 'Screw';
  }
}


function openSettings() {
  document.getElementById('settings-address').textContent = _address || '…';
  document.getElementById('settings-copy-hint').textContent = t('settings.addressHint','click address to copy');
  document.getElementById('settings-my-name').value = getMyName();
  if (_address) document.getElementById('settings-avatar').src = generateIdenticon(_address, 56);

  const langSel = document.getElementById('settings-lang');
  if (langSel) langSel.value = window._lang || 'en';


  const privacy = loadPrivacySettings();
  document.getElementById('setting-sync-contacts').checked = privacy.syncContacts;
  document.getElementById('setting-sync-messages').checked = privacy.syncMessages;
  document.getElementById('setting-show-system-messages').checked = privacy.showSystemMessages;
  document.getElementById('privacy-hint').textContent = '';

  document.getElementById('modal-settings').classList.add('show');
  switchSettingsTab('settings');
  refreshPushButton();
  generateShareQr();
}

async function savePrivacySettings() {
  const syncContacts = document.getElementById('setting-sync-contacts').checked;
  const syncMessages = document.getElementById('setting-sync-messages').checked;
  const showSystemMessages = document.getElementById('setting-show-system-messages').checked;
  const prev = loadPrivacySettings();

  savePrivacySettings$internal({ syncContacts, syncMessages, showSystemMessages });


  if (prev.showSystemMessages !== showSystemMessages) renderChat();

  const hint = document.getElementById('privacy-hint');


  if (prev.syncContacts && !syncContacts) {
    if (confirm(t('settings.deleteServerContacts','Delete contacts from server? Local copy stays.'))) {
      await deleteAllContactsFromServer();
      hint.textContent = t('settings.serverDeleted','✅ Contacts deleted from server');
    } else {
      hint.textContent = t('settings.serverKept','⚠ Server contacts kept, sync disabled');
    }
    setTimeout(() => { hint.textContent = ''; }, 4000);
    return;
  }


  if (!prev.syncContacts && syncContacts) {
    hint.textContent = t('settings.syncContacts','⏳ Syncing contacts…');
    await syncAllContactsToServer();
    hint.textContent = t('settings.syncDone','✅ Contacts synced');
    setTimeout(() => { hint.textContent = ''; }, 3000);
    return;
  }

  hint.textContent = t('saved','✅ Saved');
  setTimeout(() => { hint.textContent = ''; }, 2000);
}
function closeSettings() {
  document.getElementById('modal-settings').classList.remove('show');
}
function saveMyName() {
  const name = document.getElementById('settings-my-name').value.trim();
  setMyName(name);
  const hint = document.getElementById('settings-name-hint');
  hint.textContent = t('saved','✅ Saved');
  setTimeout(() => { hint.textContent = ''; }, 2000);
}
function copySettingsAddress() {
  if (!_address) return;
  navigator.clipboard.writeText(_address).then(() => {
    document.getElementById('settings-copy-hint').textContent = t('copied','✅ Copied!');
    setTimeout(() => {
      document.getElementById('settings-copy-hint').textContent = t('settings.addressHint','click address to copy');
    }, 2000);
  });
}


function _buildShareUrl() {


  const base = location.origin;
  const name = getMyName();
  let url = base + '/add.html?addr=' + encodeURIComponent(_address);
  if (name) url += '&name=' + encodeURIComponent(name);
  return url;
}

function generateShareQr() {
  if (!_address || typeof qrcode === 'undefined') return;
  const url = _buildShareUrl();
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const canvas = document.getElementById('qr-canvas');
    if (!canvas) return;
    const size = 160;
    const ctx  = canvas.getContext('2d');
    const cells = qr.getModuleCount();
    const quiet = 4;
    const cell  = Math.floor(size / (cells + quiet * 2));
    const offset = Math.floor((size - cells * cell) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
        }
      }
    }
  } catch(e) {
    console.warn('[qr] generation error:', e);
  }

  // ShowAPI
  const btnShare = document.getElementById('btn-web-share');
  if (btnShare && navigator.share) btnShare.style.display = '';
}

function copyShareLink() {
  const url = _buildShareUrl();
  navigator.clipboard.writeText(url).then(() => {
    const hint = document.getElementById('share-copy-hint');
    hint.textContent = t('menu.linkCopied','✅ Link copied');
    setTimeout(() => { hint.textContent = ''; }, 2500);
  }).catch(() => {
    prompt('Copy link:', url);
  });
}

function webShareAddress() {
  if (!navigator.share) return;
  const url  = _buildShareUrl();
  const name = getMyName();
  navigator.share({
    title: name ? `Add ${name} to Screw` : 'Add to Screw',
    text:  'Open link to add me on Screw',
    url,
  }).catch(() => {});
}




function _handlePendingAdd() {
  const params = new URLSearchParams(location.search);

  let addrRaw = params.get('pending_add') || '';
  let nameRaw = params.get('pending_name') || '';


  if (addrRaw.startsWith('web+screw://')) {
    try {
      const u = new URL(addrRaw);
      // web+screw://add/<addr>  → pathname = /add/<addr>
      const parts = u.pathname.replace(/^\//, '').split('/');
      if (parts[0] === 'add' && parts[1]) addrRaw = parts[1];
      if (!nameRaw && u.searchParams.get('name')) nameRaw = u.searchParams.get('name');
    } catch {}
  }


  const addr = validateAddress(addrRaw);
  if (!addr) return;

  const name = sanitizeName(nameRaw);


  const cleanUrl = location.pathname;
  history.replaceState(null, '', cleanUrl);


  setTimeout(() => {
    const contacts = loadContacts();
    const already  = contacts.find(c => c.address === addr);
    if (already) {

      personalConversationId(_address, addr).then(cid => openConversation(cid, addr));
      return;
    }
    // Open
    document.getElementById('modal-addr-input').value    = addr;
    document.getElementById('modal-addr-input').readOnly = true;
    document.getElementById('modal-addr-name').value     = name;
    document.getElementById('modal-add-by-addr').classList.add('show');
  }, 800);
}


function resetAll() {
  if (!confirm(t('settings.confirmReset','Reset everything? Keys, contacts and messages will be permanently deleted.'))) return;
  _unreadCounts = {};
  localStorage.clear();
  indexedDB.deleteDatabase('screw-identity');

  if ('caches' in window) caches.delete(FILE_CACHE_NAME);
  alert(t('settings.resetDone','Done. Page will reload.'));
  location.reload();
}


async function hardReload() {
  try {
    if ('caches' in window) {
      // DeleteSW +
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {
    console.warn('[hardReload] cache clear error:', e);
  }
  location.reload(true);
}


let _selectedGroupMembers = new Set();

function openCreateGroup(type) {
  _selectedGroupMembers = new Set();
  document.getElementById('create-group-type').value = type;
  document.getElementById('create-group-title').textContent = type === 'channel' ? t('group.createChannel','📢 Create channel') : t('group.createTitle','👥 Create group');
  document.getElementById('create-group-topic').value = '';
  document.getElementById('create-group-error').textContent = '';


  const contacts = loadContacts().filter(c => c.status !== 'blocked' && c.pubKeyB64);
  const el = document.getElementById('create-group-members');
  if (!contacts.length) {
    el.innerHTML = '<div class="contacts-popup-empty">' + t('group.noActiveContacts','no active contacts with keys') + '</div>';
  } else {
    el.innerHTML = contacts.map(c => {
      const name = c.name || `${c.address.slice(0,4)}…${c.address.slice(-4)}`;
      return `<label class="create-group-member-label">
        <input type="checkbox" data-addr="${c.address}" onchange="toggleGroupMember(this)">
        <img src="${generateIdenticon(c.address, 24)}" width="24" height="24" alt="" class="avatar-sm">
        <span>${escapeHtml(name)}</span>
      </label>`;
    }).join('');
  }
  document.getElementById('modal-create-group').classList.add('show');
}

function toggleGroupMember(checkbox) {
  if (checkbox.checked) _selectedGroupMembers.add(checkbox.dataset.addr);
  else _selectedGroupMembers.delete(checkbox.dataset.addr);
}

function closeCreateGroup() {
  document.getElementById('modal-create-group').classList.remove('show');
}

async function saveCreateGroup() {
  const topic = document.getElementById('create-group-topic').value.trim();
  const type  = document.getElementById('create-group-type').value;
  const errEl = document.getElementById('create-group-error');

  if (!topic) { errEl.textContent = t('group.noTopic','⚠ Enter a name'); return; }

  const group = await createGroup(topic, type);

  // Addinvite
  const members = Array.from(_selectedGroupMembers);
  if (members.length) {
    group.roster.push(...members);
    group.roster_version = await rosterVersion(group.roster);
    saveGroup(group);
    await sendGroupInvite(group, members);
  }

  closeCreateGroup();
  await openConversation(group.conversation_id, null);
}


function openGroupMembers(conversationId) {
  const group = getGroup(conversationId);
  if (!group) return;

  document.getElementById('group-members-title').textContent =
    (group.type === 'channel' ? '📢 ' : '👥 ') + escapeHtml(group.topic);

  const contacts = loadContacts();
  const listEl   = document.getElementById('group-members-list');
  listEl.innerHTML = group.roster.map(addr => {
    const c    = contacts.find(c => c.address === addr);
    const name = addr === _address ? t('you','You') : (c?.name || `${addr.slice(0,4)}…${addr.slice(-4)}`);
    const isOwner = addr === group.owner_address;
    const removeBtn = addr !== _address
      ? `<button onclick="removeMemberFromGroup('${conversationId}', '${addr}'); closeGroupMembers();" class="btn-group-member-remove">✕</button>`
      : '';
    return `<div class="group-member-row">
      <img src="${generateIdenticon(addr, 28)}" width="28" height="28" alt="" class="avatar-sm">
      <div class="group-member-row-inner">${escapeHtml(name)}${isOwner ? ' <span class="group-member-owner-badge">owner</span>' : ''}</div>
      ${removeBtn}
    </div>`;
  }).join('');


  const addEl = document.getElementById('group-add-member');
  const available = contacts.filter(c => c.status !== 'blocked' && c.pubKeyB64 && !group.roster.includes(c.address));
  if (available.length) {
    addEl.style.display = '';
    document.getElementById('group-add-member-list').innerHTML = available.map(c => {
      const name = c.name || `${c.address.slice(0,4)}…${c.address.slice(-4)}`;
      return `<button onclick="addMemberToGroup('${conversationId}','${c.address}'); closeGroupMembers();"
        class="group-add-member-btn">
        <img src="${generateIdenticon(c.address,22)}" width="22" height="22" alt="" class="avatar-sm">
        <span>${escapeHtml(name)}</span>
      </button>`;
    }).join('');
  } else {
    addEl.style.display = 'none';
  }

  document.getElementById('modal-group-members').classList.add('show');
}

function closeGroupMembers() {
  document.getElementById('modal-group-members').classList.remove('show');
}

// ─── Export───────────────────────────────────────────────────────────
async function exportDump() {
  try {
    const includeMessages = confirm(
      'Include message history in dump?\n\n' +
      'OK — full dump (keys + contacts + messages)\n' +
      'Cancel — minimal dump (keys + contacts only)\n\n' +
      'Minimal is convenient for a second device — messages will sync from server.'
    );

    const db = await openDB();
    const exportKey = async (key, db) => {
      const k = await dbGet(db, key);
      if (!k) return null;
      return bufToB64(await crypto.subtle.exportKey(
        (key === 'publicKey' || key === 'signPublicKey') ? 'spki' : 'pkcs8', k
      ));
    };
    const [publicKey, privateKey, signPublicKey, signPrivateKey] = await Promise.all([
      exportKey('publicKey', db), exportKey('privateKey', db),
      exportKey('signPublicKey', db), exportKey('signPrivateKey', db),
    ]);


    const EXCLUDE_ALWAYS = new Set([
      'screw-last-conv-id',
      'screw-device-id',     // device UUID — unique per device
      'screw-auth-token',    // JWT — reissued on registration
      'screw-unread',
    ]);

    const EXCLUDE_MIN = includeMessages ? new Set() : new Set([
      'screw-messages',
      'screw-last-server-ts',
    ]);

    const lsData = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!EXCLUDE_ALWAYS.has(k) && !EXCLUDE_MIN.has(k)) lsData[k] = localStorage.getItem(k);
    }

    const dump = {
      version: 2,
      exported_at: new Date().toISOString(),
      screw_url: SERVER_URL,
      full: includeMessages,
      identity: { address: _address, publicKey, privateKey, signPublicKey, signPrivateKey },
      localStorage: lsData,
    };

    const json = JSON.stringify(dump, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const kind = includeMessages ? 'full' : 'keys';
    const a    = document.createElement('a');
    a.href = url; a.download = `screw-dump-${_address.slice(0, 8)}-${kind}-${ts}.json`; a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export error: ' + e.message);
  }
}

// ─── Import────────────────────────────────────────────────────────────
async function importDump(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  let dump;
  try { dump = JSON.parse(await file.text()); }
  catch { alert(t('import.readError','Could not read file.')); return; }

  if (!dump.identity?.privateKey || !dump.identity?.publicKey) {
    alert(t('import.invalidDump','Not a valid Screw dump — keys missing.'));
    return;
  }

  const msgCount     = (() => { try { return JSON.parse(dump.localStorage['screw-messages'] || '[]').length; } catch { return '?'; } })();
  const contactCount = (() => { try { return JSON.parse(dump.localStorage['screw-contacts'] || '[]').length; } catch { return '?'; } })();

  if (!confirm(
    `Import dump:\n  Address: ${dump.identity.address || '?'}\n  Exported: ${dump.exported_at ? new Date(dump.exported_at).toLocaleString() : '?'}\n` +
    `  Messages: ${msgCount}\n  Contacts: ${contactCount}\n\nCurrent data will be replaced. Continue?`
  )) return;

  try {
    const db         = await openDB();
    const importKey  = (b64, fmt, algo, use) => crypto.subtle.importKey(fmt, b64ToBuf(b64), algo, true, use);
    const algoOAEP   = { name: 'RSA-OAEP', hash: 'SHA-256' };
    const algoPSS    = { name: 'RSA-PSS',  hash: 'SHA-256' };

    const [pubKey, privKey, signPubKey, signPrivKey] = await Promise.all([
      importKey(dump.identity.publicKey,      'spki',  algoOAEP, ['encrypt']),
      importKey(dump.identity.privateKey,     'pkcs8', algoOAEP, ['decrypt']),
      importKey(dump.identity.signPublicKey,  'spki',  algoPSS,  ['verify']),
      importKey(dump.identity.signPrivateKey, 'pkcs8', algoPSS,  ['sign']),
    ]);
    await Promise.all([
      dbPut(db, 'publicKey', pubKey), dbPut(db, 'privateKey', privKey),
      dbPut(db, 'signPublicKey', signPubKey), dbPut(db, 'signPrivateKey', signPrivKey),
    ]);

    localStorage.clear();
    for (const [k, v] of Object.entries(dump.localStorage || {})) localStorage.setItem(k, v);



    localStorage.setItem('screw-device-id', uuidv4());
    localStorage.removeItem('screw-auth-token');

    alert(t('import.success','Dump restored. Page will reload.'));
    location.reload();
  } catch (e) {
    alert('Restore error: ' + e.message);
  }
}



function renderFileBubble(meta, messageId) {
  const now     = Math.floor(Date.now() / 1000);
  const expired = meta.expires_at && meta.expires_at < now;
  const isImage = meta.mime_type && meta.mime_type.startsWith('image/');
  const filename = escapeHtml(meta.filename || 'file');
  const sizeStr  = meta.size ? formatFileSize(meta.size) : '';


  let expiryStr = '';
  if (meta.expires_at) {
    if (expired) {
      expiryStr = '🗑 deleted';
    } else {
      const days = Math.ceil((meta.expires_at - now) / 86400);
      expiryStr = `🗑 ${days}d`;
    }
  }

  const captionHtml = meta.caption
    ? `<div class="msg-payload md-body">${renderMarkdown(meta.caption)}</div>`
    : '';

  if (expired) {
    return {
      html: `<div class="file-bubble"><div class="file-expiry expired">⏳ ${t('file.expiredServer','File deleted from server')}</div>${captionHtml}</div>`,
      expiryStr,
    };
  }



  const safeId   = escapeHtml(messageId);

  const dataAttrs = (tag) =>
    ` data-msgid="${safeId}"` +
    ` data-url="${escapeHtml(meta.url || '')}"` +
    ` data-key="${escapeHtml(meta.file_key || '')}"` +
    ` data-mime="${escapeHtml(meta.mime_type || '')}"` +
    ` data-chk="${escapeHtml(meta.checksum || '')}"` +
    ` data-name="${escapeHtml(meta.filename || 'file')}"`;

  const autoLoadTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  const isAutoImage = isImage && autoLoadTypes.includes((meta.mime_type || '').toLowerCase());
  const isAudio = (meta.mime_type || '').startsWith('audio/');

  let html;
  if (isImage) {
    const innerHtml = isAutoImage
      ? `<div class="file-loading">${t('file.loading','loading…')}</div>`
      : `<button class="file-load-btn"${dataAttrs()}>` +
          `🖼 ${filename} (${sizeStr}) — ${t('file.clickToLoad','click to load')}` +
        `</button>`;

    html = `<div class="file-bubble file-bubble-image">` +
      `<div class="file-img-wrap" id="fimg-${safeId}">${innerHtml}</div>` +
      captionHtml +
    `</div>`;

    if (isAutoImage) {
      setTimeout(() => loadFileInline(messageId, meta.url, meta.file_key, meta.mime_type, meta.checksum), 0);
    }
  } else if (isAudio) {
    html = `<div class="file-bubble file-bubble-audio">` +
        `<div class="audio-player" id="aplayer-${safeId}">` +
        `<button class="audio-play-btn" title="Play"${dataAttrs()}>▶</button>` +
        `<div class="audio-info">` +
        `<div class="audio-filename">${filename}</div>` +
        `<div class="audio-progress-row">` +
        `<span class="audio-time-cur">0:00</span>` +
        `<input type="range" class="audio-slider" value="0" min="0" max="100" step="0.1" disabled` +
          ` data-msgid="${safeId}" oninput="audioSeek('${safeId}', this.value)">` +
        `<span class="audio-time-dur">–:––</span>` +
        `</div>` +
        `</div>` +
        `<button class="file-download-btn" title="Download"${dataAttrs()}>⬇</button>` +
        `</div>` +
        captionHtml +
        `</div>`;
  } else {
    html = `<div class="file-bubble">` +
      `<div class="file-info">` +
        `<span class="file-icon">📎</span>` +
        `<div class="file-details">` +
          `<div class="file-name">${filename}</div>` +
          `<div class="file-size">${sizeStr}</div>` +
        `</div>` +
        `<button class="file-download-btn" title="Download"${dataAttrs()}>⬇</button>` +
      `</div>` +
      captionHtml +
    `</div>`;
  }

  return { html, expiryStr };
}

// ─── Decrypted files cache────────────────────────────────────────────────



const FILE_CACHE_NAME = 'screw-files-v1';

function _fileIdFromUrl(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop(); }
  catch { return url; }
}

function _cacheUrl(url) {
  return 'http://screw-cache/' + _fileIdFromUrl(url);
}

async function fetchAndDecryptCached(url, fileKeyB64, expectedChecksum) {

  if ('caches' in window) {
    try {
      const cache  = await caches.open(FILE_CACHE_NAME);
      const cached = await cache.match(_cacheUrl(url));
      if (cached) {
        return cached.arrayBuffer();
      }
    } catch (e) {
      console.warn('[file-cache] cache read error, loading directly:', e);
    }
  }


  const fileBytes = await fetchAndDecrypt(url, fileKeyB64, expectedChecksum);


  if ('caches' in window) {
    caches.open(FILE_CACHE_NAME)
      .then(cache => cache.put(_cacheUrl(url), new Response(fileBytes.slice(0))))
      .catch(e => console.warn('[file-cache] cache write error:', e));
  }

  return fileBytes;
}

async function fetchAndDecrypt(url, fileKeyB64, expectedChecksum) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to download file (HTTP ' + resp.status + ')');
  const blobBuffer = await resp.arrayBuffer();

  if (expectedChecksum) {
    const actual = await fileSha256(blobBuffer);
    if (actual !== expectedChecksum) throw new Error('File corrupted (checksum mismatch)');
  }

  const magic = new TextDecoder().decode(new Uint8Array(blobBuffer).slice(0, 8));
  if (magic !== 'SCREWENC') throw new Error('Not a Screw encrypted file');

  return await decryptFile(blobBuffer, fileKeyB64);
}

function formatFileSize(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function loadFileInline(messageId, url, fileKeyB64, mimeType, expectedChecksum) {
  const wrap = document.getElementById('fimg-' + messageId);
  if (!wrap) return;


  if (wrap.querySelector('img')) return;

  wrap.innerHTML = '<div class="file-loading">loading…</div>';
  try {
    const fileBytes = await fetchAndDecryptCached(url, fileKeyB64, expectedChecksum);
    const blob      = new Blob([fileBytes], { type: mimeType });
    const objUrl    = URL.createObjectURL(blob);
    const img       = document.createElement('img');
    img.src         = objUrl;
    img.className   = 'file-preview-img';
    img.alt         = 'image';
    img.onclick     = () => window.open(objUrl);
    img.onload      = () => { if (_inboxShouldStickToBottom) _scrollToBottom(); };
    wrap.innerHTML  = '';
    wrap.appendChild(img);  } catch (e) {
    wrap.innerHTML = `<div class="file-error">❌ ${escapeHtml(e.message)}</div>`;
  }
}

async function downloadDecryptedFile(messageId, url, fileKeyB64, filename, mimeType, expectedChecksum) {
  const btn = document.querySelector(`.file-download-btn[data-msgid="${CSS.escape(messageId)}"]`);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const fileBytes = await fetchAndDecryptCached(url, fileKeyB64, expectedChecksum);
    const blob  = new Blob([fileBytes], { type: mimeType || 'application/octet-stream' });
    const a     = document.createElement('a');
    a.href      = URL.createObjectURL(blob);
    a.download  = filename;
    a.click();
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    if (btn) { btn.textContent = '⬇'; btn.disabled = false; }
  }
}



const _audioElements = {};

function _audioFmt(sec) {
  if (!isFinite(sec)) return '–:––';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

async function audioPlay(messageId, url, fileKeyB64, mimeType, expectedChecksum) {
  const wrap = document.getElementById('aplayer-' + messageId);
  if (!wrap) return;

  const playBtn  = wrap.querySelector('.audio-play-btn');
  const slider   = wrap.querySelector('.audio-slider');
  const timeCur  = wrap.querySelector('.audio-time-cur');
  const timeDur  = wrap.querySelector('.audio-time-dur');


  if (_audioElements[messageId]) {
    const audio = _audioElements[messageId];
    if (audio.paused) {
      audio.play();
      playBtn.textContent = '▮▮';
    } else {
      audio.pause();
      playBtn.textContent = '▶';
    }
    return;
  }


  playBtn.textContent = '…';
  playBtn.disabled    = true;

  try {
    const fileBytes = await fetchAndDecryptCached(url, fileKeyB64, expectedChecksum);
    const blob      = new Blob([fileBytes], { type: mimeType });
    const objUrl    = URL.createObjectURL(blob);

    const audio = new Audio(objUrl);
    _audioElements[messageId] = audio;

    audio.addEventListener('loadedmetadata', () => {
      timeDur.textContent = _audioFmt(audio.duration);
      slider.disabled = false;
    });

    audio.addEventListener('timeupdate', () => {
      timeCur.textContent = _audioFmt(audio.currentTime);
      if (audio.duration) {
        slider.value = (audio.currentTime / audio.duration) * 100;
      }
    });

    audio.addEventListener('ended', () => {
      playBtn.textContent = '▶';
      slider.value  = 0;
      timeCur.textContent = '0:00';
    });

    audio.addEventListener('pause', () => { playBtn.textContent = '▶'; });
    audio.addEventListener('play',  () => { playBtn.textContent = '▮▮'; });

    playBtn.disabled    = false;
    playBtn.textContent = '▮▮';
    audio.play();
  } catch (e) {
    playBtn.disabled    = false;
    playBtn.textContent = '▶';
    alert('Playback error: ' + e.message);
  }
}

function audioSeek(messageId, value) {
  const audio = _audioElements[messageId];
  if (audio && audio.duration) {
    audio.currentTime = (value / 100) * audio.duration;
  }
}



document.addEventListener('click', function(e) {

  const loadBtn = e.target.closest('.file-load-btn');
  if (loadBtn) {
    const d = loadBtn.dataset;
    loadFileInline(d.msgid, d.url, d.key, d.mime, d.chk);
    return;
  }


  const dlBtn = e.target.closest('.file-download-btn');
  if (dlBtn) {
    const d = dlBtn.dataset;
    downloadDecryptedFile(d.msgid, d.url, d.key, d.name, d.mime, d.chk);
    return;
  }


  const playBtn = e.target.closest('.audio-play-btn');
  if (playBtn) {
    const d = playBtn.dataset;
    audioPlay(d.msgid, d.url, d.key, d.mime, d.chk);
    return;
  }
});





function _getPayload() { return document.getElementById('payload'); }


function mdWrap(before, after) {
  const ta    = _getPayload();
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.slice(start, end);
  const inner = sel || 'text';
  const repl  = before + inner + after;
  ta.setRangeText(repl, start, end, 'select');
  if (!sel) {

    ta.selectionStart = start + before.length;
    ta.selectionEnd   = start + before.length + inner.length;
  }
  ta.focus();
  if (typeof autoResizePayload === 'function') autoResizePayload();
}


function mdWrapBlock(before, after) {
  const ta    = _getPayload();
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.slice(start, end);
  const inner = sel || 'code';
  const repl  = before + '\n' + inner + '\n' + after;
  ta.setRangeText(repl, start, end, 'select');
  if (!sel) {
    ta.selectionStart = start + before.length + 1;
    ta.selectionEnd   = start + before.length + 1 + inner.length;
  }
  ta.focus();
  if (typeof autoResizePayload === 'function') autoResizePayload();
}


function mdWrapLines(prefix) {
  const ta    = _getPayload();
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.slice(start, end) || 'text';
  const repl  = sel.split('\n').map(l => prefix + l).join('\n');
  ta.setRangeText(repl, start, end, 'select');
  ta.focus();
  if (typeof autoResizePayload === 'function') autoResizePayload();
}


function mdInsertLink() {
  const ta    = _getPayload();
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.slice(start, end);
  const label = sel || 'text';
  const repl  = `[${label}](https://)`;
  ta.setRangeText(repl, start, end, 'select');

  const urlStart = start + label.length + 3;
  ta.selectionStart = urlStart;
  ta.selectionEnd   = urlStart + 8;
  ta.focus();
  if (typeof autoResizePayload === 'function') autoResizePayload();
}

