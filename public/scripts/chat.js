// public/scripts/chat.js
(function () {
  const API = (path, opts = {}) =>
    fetch(`${location.origin.replace(/\/$/, '')}/api/chat` + path, {
      ...opts,
      headers: {
        'Content-Type': opts.body instanceof FormData ? undefined : 'application/json',
        ...(opts.headers || {}),
        Authorization: 'Bearer ' + (localStorage.getItem('userToken') || ''),
      },
    }).then((r) => r.json());

  const API_ABS = (path, opts = {}) =>
    fetch(path, {
      ...opts,
      headers: {
        'Content-Type': opts.body instanceof FormData ? undefined : 'application/json',
        ...(opts.headers || {}),
        Authorization: 'Bearer ' + (localStorage.getItem('userToken') || ''),
      },
    }).then((r) => r.json());

  const token = localStorage.getItem('userToken');
  if (!token) {
    location.href = 'login.html';
    return;
  }

  const els = {
    list: document.getElementById('chatList'),
    messages: document.getElementById('messageList'),
    msgInput: document.getElementById('msgInput'),
    sendBtn: document.getElementById('sendBtn'),
    fileInput: document.getElementById('fileInput'),
    attachBtn: document.getElementById('attachBtn'),
    tgBack: document.getElementById('tgBack'),
    tgTitle: document.getElementById('tgTitle'),
    tgSub: document.getElementById('tgSub'),
    tgAvatarImg: document.getElementById('tgAvatarImg'),
    tgAvatarLetter: document.getElementById('tgAvatarLetter'),
    search: document.getElementById('tgSearch'),
    replyBar: document.getElementById('replyBar'),
    replyText: document.getElementById('replyText'),
    replyCancel: document.getElementById('replyCancel'),
  };

  if (!els.search) els.search = document.getElementById('searchInput');

  const urlParams = new URLSearchParams(location.search);
  const jumpId = urlParams.get('jump');

  let currentChat = null;
  let messages = [];
  let myId = null;
  let loadingHistory = false;
  let atBottom = true;
  let typingTimeout = null;
  let replyTo = null;
  let pendingAttachments = [];

  function setReply(m) {
    replyTo = m;
    if (els.replyBar) {
      els.replyBar.hidden = false;
      els.replyText.textContent = (m.text || '(вложение)').slice(0, 140);
    }
    els.msgInput?.focus();
  }

  function clearReply() {
    replyTo = null;
    if (els.replyBar) els.replyBar.hidden = true;
  }

  els.replyCancel && (els.replyCancel.onclick = clearReply);

  const mqMobile = window.matchMedia('(max-width: 900px)');
  function enterChatView() {
    if (mqMobile.matches) document.documentElement.classList.add('show-chat');
  }
  function leaveChatView() {
    document.documentElement.classList.remove('show-chat');
    currentChat = null;
    messages = [];
    els.messages.innerHTML = '';
    setHeader({ title: '', avatar: '' });
    if (els.search) els.search.value = '';
  }
  if (els.tgBack) {
    els.tgBack.addEventListener('click', (e) => {
      e.preventDefault();
      leaveChatView();
    });
  }

  function isNearBottom() {
    const el = els.messages;
    const threshold = 120;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }
  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight + 999;
  }

  fetch('/api/user/profile', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => r.json())
    .then((u) => { myId = u._id || u.id; });

  async function loadChats() {
    const data = await API('/chats');
    els.list.innerHTML = '';
    data.forEach((c) => {
      const li = document.createElement('li');
      li.className = 'chat-item';
      li.innerHTML = `
        <div class="avatar">
          <img src="${c.avatar || ''}" onerror="this.style.display='none'"/>
          <span class="online" style="display:none"></span>
        </div>
        <div class="cmeta">
          <div class="crow">
            <div class="title">${escapeHtml(c.title)}</div>
            <div class="time">${c.lastMessage ? timeShort(c.lastMessage.createdAt) : ''}</div>
          </div>
          <div class="cpreview">
            ${
              c.lastMessage
                ? escapeHtml((c.lastMessage.senderName || 'user') + ': ' + truncate(c.lastMessage.text || '', 60))
                : 'Нет сообщений'
            }
            ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}
          </div>
        </div>`;
      li.onclick = () => openChat(c);
      els.list.appendChild(li);
    });
  }

  function setHeader(chat) {
    const title = (chat?.title || '').trim() || 'Чат';
    if (els.tgTitle) els.tgTitle.textContent = title;
    if (els.tgSub) els.tgSub.textContent = '';
    const img = els.tgAvatarImg;
    const letter = els.tgAvatarLetter;
    const firstChar = (title[0] || 'A').toUpperCase();
    if (img && letter) {
      if (chat?.avatar) {
        img.src = chat.avatar;
        img.style.display = 'block';
        letter.style.display = 'none';
      } else {
        img.src = '';
        img.style.display = 'none';
        letter.style.display = 'grid';
        letter.textContent = firstChar;
      }
    }
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }
  function truncate(s, n) { return (s || '').length > n ? s.slice(0, n - 1) + '…' : s; }
  function timeShort(t) {
    const d = new Date(t);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async function openChat(c) {
    currentChat = c;
    setHeader(c);
    els.messages.innerHTML = '';
    messages = [];
    enterChatView();
    await loadHistory();
    scrollToBottom();
  }

  async function loadHistory(before) {
    if (!currentChat || loadingHistory) return;
    loadingHistory = true;
    const q = new URLSearchParams({ chatId: currentChat._id, limit: 30 });
    if (before) q.set('before', before);
    const history = await API('/messages?' + q.toString());
    messages = before ? history.concat(messages) : history;
    renderMessages();
    loadingHistory = false;
  }

  els.messages.addEventListener('scroll', () => {
    const el = els.messages;
    atBottom = isNearBottom();
    if (el.scrollTop === 0 && messages.length) loadHistory(messages[0].createdAt);
  });

  function renderMessages() {
    const prevIsNearBottom = isNearBottom();
    els.messages.innerHTML = '';
    messages.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'msg ' + (String(m.senderId) === String(myId) ? 'mine' : 'their');
      div.dataset.id = m._id;
      const replyHtml =
        m.replyTo && messages.find((x) => String(x._id) === String(m.replyTo))
          ? `<div class="reply">${escapeHtml(messages.find((x) => String(x._id) === String(m.replyTo)).text)}</div>`
          : '';
      div.innerHTML = `
        <div class="mrow">
          <div class="mavatar"><img src="${m.senderAvatar || ''}" onerror="this.style.display='none'"/></div>
          <div class="mname">${escapeHtml(m.senderName || 'user')}</div>
        </div>
        ${replyHtml}
        <div class="mtext">${escapeHtml(m.text || '')}</div>
        <div class="mmeta">
          <span>${timeShort(m.createdAt)}</span>
        </div>
      `;
      div.oncontextmenu = (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, m); };
      div.addEventListener('click', (e) => {
        if (e.target.closest('a, img, video, button, input, textarea')) return;
        showContextMenu(e.clientX || 20, e.clientY || 20, m);
      });
      els.messages.appendChild(div);
    });
    if (prevIsNearBottom) scrollToBottom();
  }

  let ctx;
  function showContextMenu(x, y, m) {
    hideContextMenu();
    ctx = document.createElement('div');
    ctx.style.position = 'fixed';
    ctx.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    ctx.style.top  = Math.min(y, window.innerHeight - 160) + 'px';
    ctx.style.background = '#0e1522';
    ctx.style.border = '1px solid #223147';
    ctx.style.borderRadius = '10px';
    ctx.style.padding = '6px';
    ctx.style.zIndex = 10000;
    ctx.style.minWidth = '160px';
    const mine = String(m.senderId) === String(myId);
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.display = 'block';
      b.style.width = '100%';
      b.style.background = 'transparent';
      b.style.border = '0';
      b.style.color = 'white';
      b.style.padding = '10px 12px';
      b.style.textAlign = 'left';
      b.style.fontSize = '16px';
      b.style.cursor = 'pointer';
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => { fn(); hideContextMenu(); };
      ctx.appendChild(b);
    };
    mk('Ответить', () => setReply(m));
    mk('😊 Реакция', () => { react(m, '👍'); });
    if (mine) {
      mk('Редактировать', () => {
        const nt = prompt('Изменить сообщение', m.text || '');
        if (nt != null) socket.emit('message:edit', { id: m._id, text: nt }, ackHandler);
      });
      mk('Удалить', () => {
        if (confirm('Удалить?')) socket.emit('message:delete', { id: m._id }, ackHandler);
      });
    }
    document.body.appendChild(ctx);
    setTimeout(() => {
      window.addEventListener('click', hideContextMenu, { once:true });
      window.addEventListener('touchstart', hideContextMenu, { once:true, passive:true });
    });
  }
  function hideContextMenu() { if (ctx) { ctx.remove(); ctx = null; } }
  function react(m, emoji) { socket.emit('message:react', { id: m._id, emoji }, ackHandler); }

  els.attachBtn && (els.attachBtn.onclick = () => els.fileInput.click());
  if (els.fileInput) {
    els.fileInput.onchange = async () => {
      const fd = new FormData();
      [...els.fileInput.files].forEach((f) => fd.append('files', f));
      const res = await fetch('/api/chat/attachments', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd,
      }).then((r) => r.json());
      pendingAttachments = res.files || [];
    };
  }

  const socket = io('/', { auth: { token: token } });

  socket.on('message:new', (m) => {
    if (!currentChat || String(m.chatId) !== String(currentChat._id)) return;
    messages.push(m);
    renderMessages();
    if (isNearBottom()) scrollToBottom();
  });

  if (els.msgInput) els.msgInput.addEventListener('input', autoGrow);
  function autoGrow() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 160) + 'px';
    socket.emit('typing', { isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('typing', { isTyping: false }), 1500);
  }
  function ackHandler(res) { if (!res?.ok) alert(res?.error || 'Ошибка'); }

  els.sendBtn && (els.sendBtn.onclick = send);
  els.msgInput && els.msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  function send() {
    if (!currentChat) return;
    const text = (els.msgInput.value || '').trim();
    if (!text && pendingAttachments.length === 0) return;
    const payload = { text, attachments: pendingAttachments };
    if (replyTo) payload.replyTo = replyTo._id;
    socket.emit('message:send', payload, (ack) => {
      if (ack?.ok) {
        els.msgInput.value = '';
        els.msgInput.style.height = 'auto';
        pendingAttachments = [];
        clearReply();
      } else {
        alert(ack?.error || 'Не отправлено');
      }
    });
  }

  loadChats();
})();