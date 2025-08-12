// public/scripts/chat.js
(function () {
  const API = (path, opts = {}) =>
    fetch(`${location.origin.replace(/\/$/, '')}/api/chat` + path, {
      ...opts,
      headers: {
        'Content-Type':
          opts.body instanceof FormData ? undefined : 'application/json',
        ...(opts.headers || {}),
        Authorization: 'Bearer ' + (localStorage.getItem('userToken') || ''),
      },
    }).then((r) => r.json());

  const API_ABS = (path, opts = {}) =>
    fetch(path, {
      ...opts,
      headers: {
        'Content-Type':
          opts.body instanceof FormData ? undefined : 'application/json',
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
    search: document.getElementById('searchInput'),
    chatTitle: document.getElementById('chatTitle'),
    chatTyping: document.getElementById('chatTyping'),
    chatBack: document.getElementById('chatBack'),
    chatAvatar: document.getElementById('chatAvatar'),
  };

  const urlParams = new URLSearchParams(location.search);
  const jumpId = urlParams.get('jump');

  let currentChat = null;
  let messages = [];
  let myId = null;
  let loadingHistory = false;
  let atBottom = true;
  let typingTimeout = null;
  let replyTo = null;

  // ——— helpers: responsive view ———
  const mqMobile = window.matchMedia('(max-width: 900px)');
  function enterChatView() {
    if (mqMobile.matches) {
      document.documentElement.classList.add('show-chat');
      if (els.chatBack) els.chatBack.style.display = 'inline-flex';
    }
  }
  function leaveChatView() {
    document.documentElement.classList.remove('show-chat');
    if (els.chatBack) els.chatBack.style.display = 'none';
    currentChat = null;
    messages = [];
    els.messages.innerHTML = '';
    els.chatTitle.textContent = '';
    if (els.search) els.search.value = '';
  }
  if (els.chatBack) {
    els.chatBack.addEventListener('click', (e) => {
      e.preventDefault();
      leaveChatView();
    });
  }

  // Smart scroll helpers
  function isNearBottom() {
    const el = els.messages;
    const threshold = 120;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }
  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight + 999;
  }

  // Load my profile
  fetch('/api/user/profile', {
    headers: { Authorization: 'Bearer ' + token },
  })
    .then((r) => r.json())
    .then((u) => {
      myId = u._id || u.id;
    });

  // Load chat list
  async function loadChats() {
    const data = await API('/chats');
    els.list.innerHTML = '';
    data.forEach((c) => {
      const li = document.createElement('li');
      li.className = 'chat-item';
      li.innerHTML = `
        <div class="avatar">
          <img src="${c.avatar || 'menu.css'.slice(999)}" style="display:none"/>
          <span class="online" style="display:none"></span>
        </div>
        <div class="cmeta">
          <div class="crow">
            <div class="title">${escapeHtml(c.title)}</div>
            <div class="time">${c.lastMessage ? timeShort(c.lastMessage.createdAt) : ''}</div>
          </div>
          <div class="cpreview">${
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

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function truncate(s, n) {
    return (s || '').length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function timeShort(t) {
    const d = new Date(t);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async function openChat(c) {
    currentChat = c;
    if (els.chatTitle) els.chatTitle.textContent = c.title || '';
    if (els.chatAvatar) {
      els.chatAvatar.src = c.avatar || '';
      els.chatAvatar.alt = (c.title || 'A').slice(0, 1);
    }

    els.messages.innerHTML = '';
    messages = [];
    enterChatView();
    await loadHistory();
    scrollToBottom();

    if (jumpId) {
      try {
        const meta = await API_ABS(`/api/chat/message/${encodeURIComponent(jumpId)}`);
        if (meta?.createdAt) {
          const before = new Date(new Date(meta.createdAt).getTime() + 1).toISOString();
          const q = new URLSearchParams({ chatId: currentChat._id, limit: 200, before });
          const pack = await API('/messages?' + q.toString());
          messages = pack;
          renderMessages();
          const target = els.messages.querySelector(`[data-id="${CSS.escape(jumpId)}"]`);
          if (target) {
            target.scrollIntoView({ block: 'center' });
            target.style.outline = '2px solid #5aa9ff';
            setTimeout(() => (target.style.outline = ''), 1500);
          } else {
            scrollToBottom();
          }
        }
      } catch {}
    }
  }

  async function loadHistory(before) {
    if (!currentChat) return;
    if (loadingHistory) return;
    loadingHistory = true;
    const q = new URLSearchParams({ chatId: currentChat._id, limit: 30 });
    if (before) q.set('before', before);
    const history = await API('/messages?' + q.toString());
    messages = before ? history.concat(messages) : history;
    renderMessages();
    loadingHistory = false;
  }

  // Infinite scroll up
  els.messages.addEventListener('scroll', () => {
    const el = els.messages;
    atBottom = isNearBottom();
    if (el.scrollTop === 0 && messages.length) {
      loadHistory(messages[0].createdAt);
    }
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

      const attachHtml = (m.attachments || [])
        .map((a) => {
          if ((a.mimetype || '').startsWith('image/')) {
            return `<div class="attach"><img src="${a.url}" style="max-width:240px;max-height:180px;border-radius:10px"/></div>`;
          } else if ((a.mimetype || '').startsWith('video/')) {
            return `<div class="attach"><video src="${a.url}" controls style="max-width:260px;max-height:200px;border-radius:10px"></video></div>`;
          } else {
            return `<a class="attach" href="${a.url}" target="_blank">${escapeHtml(a.originalname || 'Файл')}</a>`;
          }
        })
        .join('');

      const reactionsHtml = (m.reactions || []).map((r) => r.emoji).join(' ');

      div.innerHTML = `
        <button class="reply-btn" title="Ответить" aria-label="Ответить">↩</button>
        <div class="mrow">
          <div class="mavatar"><img src="${m.senderAvatar || ''}" onerror="this.style.display='none'"/><span class="online" style="display:none"></span></div>
          <div class="mname">${escapeHtml(m.senderName || 'user')}</div>
        </div>
        ${replyHtml}
        <div class="mtext">${escapeHtml(m.text || '')}</div>
        ${attachHtml}
        <div class="mmeta">
          <span>${timeShort(m.createdAt)}</span>
          ${String(m.senderId) === String(myId) ? `<span class="ticks" title="Доставлено/Прочитано">✓✓</span>` : ''}
          ${reactionsHtml ? `<span>${reactionsHtml}</span>` : ''}
        </div>
      `;

      // явная кнопка «Ответить»
      const replyBtn = div.querySelector('.reply-btn');
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        replyTo = m;
        els.msgInput.focus();
      });

      // ПК: правый клик — меню
      div.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e.pageX, e.pageY, m);
      };

      // МОБИЛКА: длинное нажатие — меню
      bindLongPress(div, (pt) => {
        // pt = {x, y} — координаты, где показывать меню
        showContextMenu(pt.x, pt.y, m);
      });

      els.messages.appendChild(div);
    });
    if (prevIsNearBottom) scrollToBottom();
  }

  // Long-press helper (мобилки)
  function bindLongPress(el, onLong) {
    let timer = null;
    let startX = 0, startY = 0;

    el.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
      // запускаем таймер долгого нажатия (350–500мс комфортно)
      timer = setTimeout(() => {
        timer = null;
        onLong({ x: startX, y: startY });
      }, 400);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (!timer) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (dx*dx + dy*dy > 100) { // ~10px
        clearTimeout(timer); timer = null;
      }
    }, { passive: true });

    el.addEventListener('touchend', () => {
      if (timer) { clearTimeout(timer); timer = null; }
    });

    el.addEventListener('touchcancel', () => {
      if (timer) { clearTimeout(timer); timer = null; }
    });
  }

  // Мини-меню действий
  let ctx;
  function showContextMenu(x, y, m) {
    hideContextMenu();
    ctx = document.createElement('div');
    ctx.style.position = 'fixed';
    ctx.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    ctx.style.top  = Math.min(y, window.innerHeight - 140) + 'px';
    ctx.style.background = '#0e1522';
    ctx.style.border = '1px solid #223147';
    ctx.style.borderRadius = '10px';
    ctx.style.padding = '6px';
    ctx.style.zIndex = 10000;
    ctx.style.minWidth = '140px';

    const mine = String(m.senderId) === String(myId);
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.display = 'block';
      b.style.width = '100%';
      b.style.background = 'transparent';
      b.style.border = '0';
      b.style.color = 'white';
      b.style.padding = '8px 10px';
      b.style.textAlign = 'left';
      b.style.fontSize = '16px'; // >=16px чтобы не вызывался зум
      b.onclick = () => { fn(); hideContextMenu(); };
      ctx.appendChild(b);
    };

    mk('Ответить', () => { replyTo = m; els.msgInput.focus(); });
    mk('😊 Реакция', () => { react(m, '👍'); });
    if (mine) {
      mk('Редактировать', () => {
        const nt = prompt('Изменить сообщение', m.text || '');
        if (nt != null) socket.emit('message:edit', { id:m._id, text:nt }, ackHandler);
      });
      mk('Удалить', () => {
        if (confirm('Удалить?')) socket.emit('message:delete', { id:m._id }, ackHandler);
      });
    }

    document.body.appendChild(ctx);
    // Закрывать по тапу где угодно
    setTimeout(() => {
      window.addEventListener('click', hideContextMenu, { once:true });
      window.addEventListener('touchstart', hideContextMenu, { once:true, passive:true });
    });
  }
  function hideContextMenu() { if (ctx) { ctx.remove(); ctx = null; } }

  function react(m, emoji) {
    socket.emit('message:react', { id: m._id, emoji }, ackHandler);
  }

  // Attachments
  els.attachBtn.onclick = () => els.fileInput.click();
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
  let pendingAttachments = [];

  // Socket connection
  const socket = io('/', { auth: { token: token } });

  socket.on('connect', () => {});
  socket.on('message:new', (m) => {
    if (!currentChat || String(m.chatId) !== String(currentChat._id)) return;
    messages.push(m);
    renderMessages();
    if (isNearBottom()) scrollToBottom();
    maybeMarkRead([m]);
  });
  socket.on('message:edited', ({ id, text, editedAt }) => {
    const m = messages.find((x) => String(x._id) === String(id));
    if (m) { m.text = text; m.editedAt = editedAt; renderMessages(); }
  });
  socket.on('message:deleted', ({ id }) => {
    const idx = messages.findIndex((x) => String(x._id) === String(id));
    if (idx > -1) { messages.splice(idx, 1); renderMessages(); }
  });
  socket.on('message:reactions', ({ id, reactions }) => {
    const m = messages.find((x) => String(x._id) === String(id));
    if (m) { m.reactions = reactions; renderMessages(); }
  });
  socket.on('message:reads', () => {});
  socket.on('typing', ({ userId, isTyping }) => {
    els.chatTyping.textContent = isTyping ? '... печатает' : '';
  });

  // composer
  els.msgInput.addEventListener('input', autoGrow);
  function autoGrow() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 160) + 'px';
    socket.emit('typing', { isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(
      () => socket.emit('typing', { isTyping: false }),
      1500,
    );
  }

  function ackHandler(res) { if (!res?.ok) alert(res?.error || 'Ошибка'); }

  els.sendBtn.onclick = send;
  els.msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  function send() {
    if (!currentChat) return;
    const text = els.msgInput.value.trim();
    if (!text && pendingAttachments.length === 0) return;
    const payload = { text, attachments: pendingAttachments };
    if (replyTo) payload.replyTo = replyTo._id;
    socket.emit('message:send', payload, (ack) => {
      if (ack?.ok) {
        els.msgInput.value = '';
        els.msgInput.style.height = 'auto';
        pendingAttachments = [];
        replyTo = null;
      } else {
        alert(ack?.error || 'Не отправлено');
      }
    });
  }

  function maybeMarkRead(newMsgs) {
    const ids = (newMsgs || messages)
      .filter((m) => String(m.senderId) !== String(myId))
      .map((m) => m._id);
    if (ids.length) socket.emit('message:read', { ids }, () => {});
  }

  // search
  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!currentChat) return;
      const q = els.search.value.trim();
      if (!q) {
        messages = await API(
          '/messages?' + new URLSearchParams({ chatId: currentChat._id, limit: 30 }),
        );
        renderMessages();
        return;
      }
      const list = await API(
        `/search?chatId=${currentChat._id}&q=${encodeURIComponent(q)}`,
      );
      messages = list;
      renderMessages();
    }, 300);
  });

  // init
  loadChats();
})();
