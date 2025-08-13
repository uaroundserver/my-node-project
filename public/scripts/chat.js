// public/scripts/chat.js
(function () {
  // --- helpers to call API ---
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

  // --- auth guard ---
  const token = localStorage.getItem('userToken');
  if (!token) {
    location.href = 'login.html';
    return;
  }

  // --- elements ---
  const els = {
    // список/лента/композер
    list: document.getElementById('chatList'),
    messages: document.getElementById('messageList'),
    msgInput: document.getElementById('msgInput'),
    sendBtn: document.getElementById('sendBtn'),
    fileInput: document.getElementById('fileInput'),
    attachBtn: document.getElementById('attachBtn'),

    // шапка
    tgBack: document.getElementById('tgBack'),
    tgTitle: document.getElementById('tgTitle'),
    tgSub: document.getElementById('tgSub'),
    tgAvatarImg: document.getElementById('tgAvatarImg'),
    tgAvatarLetter: document.getElementById('tgAvatarLetter'),

    // поиск
    search: document.getElementById('tgSearch'),

    // панель ответа
    replyBar: document.getElementById('replyBar'),
    replyText: document.getElementById('replyText'),
    replyCancel: document.getElementById('replyCancel'),
  };

  // поддержка старых id (если не всё успел заменить в HTML)
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

  // --- responsive: список -> чат ---
  const mqMobile = window.matchMedia('(max-width: 900px)');
  function enterChatView() {
    if (mqMobile.matches) document.documentElement.classList.add('show-chat');
  }
  function leaveChatView() {
    document.documentElement.classList.remove('show-chat');
    currentChat = null;
    messages = [];
    els.messages && (els.messages.innerHTML = '');
    setHeader({ title: '', avatar: '' });
    if (els.search) els.search.value = '';
    clearReply();
  }
  if (els.tgBack) {
    els.tgBack.addEventListener('click', (e) => {
      e.preventDefault();
      leaveChatView();
    });
  }

  // --- scroll helpers ---
  function isNearBottom() {
    const el = els.messages;
    if (!el) return true;
    const threshold = 120;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }
  function scrollToBottom() {
    if (els.messages) els.messages.scrollTop = els.messages.scrollHeight + 999;
  }

  // --- my profile ---
  fetch('/api/user/profile', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => r.json())
    .then((u) => { myId = u._id || u.id; });

  // --- chat list ---
  async function loadChats() {
    const data = await API('/chats');
    if (!els.list) return;
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

  // --- header setter (title + avatar fallback) ---
  function setHeader(chat) {
    const title = (chat?.title || '').trim() || 'Чат';
    if (els.tgTitle) els.tgTitle.textContent = title;

    // сабтайтл: печатает / пусто
    if (els.tgSub) els.tgSub.textContent = '';

    // аватар: если есть URL — показываем <img>, иначе буква
    const img = els.tgAvatarImg;
    const letter = els.tgAvatarLetter;
    const firstChar = (title[0] || 'A').toUpperCase();

    if (img && letter) {
      if (chat?.avatar) {
        img.src = chat.avatar;
        img.style.display = 'block';
        if (letter) letter.style.display = 'none';
      } else {
        img && (img.src = '');
        img && (img.style.display = 'none');
        if (letter) {
          letter.style.display = 'grid';
          letter.textContent = firstChar;
        }
      }
    }
  }

  // --- utils ---
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }
  function truncate(s, n) { return (s || '').length > n ? s.slice(0, n - 1) + '…' : s; }
  function timeShort(t) {
    const d = new Date(t);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // --- open chat ---
  async function openChat(c) {
    currentChat = c;
    setHeader(c);

    if (els.messages) els.messages.innerHTML = '';
    messages = [];
    enterChatView();
    await loadHistory();
    scrollToBottom();

    // прыжок по messageId
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

  // --- history / infinite up ---
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

  els.messages && els.messages.addEventListener('scroll', () => {
    const el = els.messages;
    atBottom = isNearBottom();
    if (el.scrollTop === 0 && messages.length) loadHistory(messages[0].createdAt);
  });

  // --- render messages (with swipe-to-reply + vibration) ---
  function renderMessages() {
    if (!els.messages) return;
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
        <div class="mrow">
          <div class="mavatar"><img src="${m.senderAvatar || ''}" onerror="this.style.display='none'"/></div>
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

      // --- ПК: правый клик — меню ---
      div.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, m);
      };

      // --- Клик — меню ---
      div.addEventListener('click', (e) => {
        if (e.target.closest('a, img, video, button, input, textarea')) return;
        const x = e.clientX || 20;
        const y = e.clientY || 20;
        showContextMenu(x, y, m);
      });

      // --- Свайп вправо (мобилка) с анимацией и вибрацией ---
      if (mqMobile.matches) {
        let touchStartX = 0, touchStartY = 0, swipedDX = 0, vibed = false;
        const SWIPE_READY = 56, SWIPE_MAX = 84, V_TOL = 24;

        div.addEventListener('touchstart', (e) => {
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          touchStartX = t.clientX; touchStartY = t.clientY;
          swipedDX = 0; vibed = false;
          div.classList.add('is-swiping');
        }, { passive: true });

        div.addEventListener('touchmove', (e) => {
          if (!touchStartX) return;
          const t = e.touches[0];
          const dx = t.clientX - touchStartX;
          const dy = Math.abs(t.clientY - touchStartY);
          if (dy > V_TOL) { resetSwipe(); return; }
          if (dx > 0) {
            swipedDX = Math.min(dx, SWIPE_MAX);
            div.style.transform = `translateX(${swipedDX}px)`;
            if (swipedDX >= SWIPE_READY) {
              div.classList.add('swipe-ready');
              if (!vibed) { navigator.vibrate?.(30); vibed = true; }
            } else {
              div.classList.remove('swipe-ready');
            }
            e.preventDefault();
          }
        }, { passive: false });

        const resetSwipe = () => {
          div.style.transition = 'transform 160ms ease';
          div.style.transform = 'translateX(0)';
          setTimeout(() => { div.style.transition = ''; }, 180);
          touchStartX = 0; touchStartY = 0; swipedDX = 0; vibed = false;
          div.classList.remove('is-swiping', 'swipe-ready');
        };

        div.addEventListener('touchend', () => {
          if (!touchStartX) return;
          const shouldReply = swipedDX >= SWIPE_READY;
          resetSwipe();
          if (shouldReply) setReply(m);
        }, { passive: true });

        div.addEventListener('touchcancel', () => resetSwipe(), { passive: true });
      }

      els.messages.appendChild(div);
    });

    if (prevIsNearBottom) scrollToBottom();
  }

  // --- context menu (устойчивое) ---
  let ctx = null;
  let onWinClick = null;
  let onWinTouch = null;

  function showContextMenu(x, y, m) {
    hideContextMenu(); // на всякий случай

    ctx = document.createElement('div');
    ctx.style.position = 'fixed';
    ctx.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    ctx.style.top  = Math.min(y, window.innerHeight - 180) + 'px';
    ctx.style.background = '#0e1522';
    ctx.style.border = '1px solid #223147';
    ctx.style.borderRadius = '10px';
    ctx.style.padding = '6px';
    ctx.style.zIndex = 10000;
    ctx.style.minWidth = '160px';
    ctx.style.boxShadow = '0 8px 24px rgba(0,0,0,.35)';

    // Не закрывать при клике внутри меню
    ctx.addEventListener('click', (e) => e.stopPropagation());
    ctx.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

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

    // Подписки на закрытие — ставим после добавления меню
    onWinClick = (ev) => {
      if (!ctx.contains(ev.target)) hideContextMenu();
    };
    onWinTouch = (ev) => {
      if (!ctx.contains(ev.target)) hideContextMenu();
    };
    window.addEventListener('click', onWinClick);
    window.addEventListener('touchstart', onWinTouch, { passive: true });
  }

  function hideContextMenu() {
    if (ctx) {
      ctx.remove();
      ctx = null;
    }
    if (onWinClick) {
      window.removeEventListener('click', onWinClick);
      onWinClick = null;
    }
    if (onWinTouch) {
      window.removeEventListener('touchstart', onWinTouch);
      onWinTouch = null;
    }
  }

  function react(m, emoji) {
    socket.emit('message:react', { id: m._id, emoji }, ackHandler);
  }

  // --- reply helpers ---
  function setReply(m) {
    replyTo = m;
    if (els.replyBar) {
      els.replyBar.hidden = false;
      els.replyText && (els.replyText.textContent = (m.text || '(вложение)').slice(0, 140));
    }
    els.msgInput && els.msgInput.focus();
  }
  function clearReply() {
    replyTo = null;
    if (els.replyBar) els.replyBar.hidden = true;
  }
  els.replyCancel && (els.replyCancel.onclick = clearReply);

  // --- attachments ---
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

  // --- уведомления: helper'ы ---
  async function isReplyToMe(m) {
    try {
      if (!m?.replyTo) return false;
      const meta = await API_ABS(`/api/chat/message/${encodeURIComponent(m.replyTo)}`);
      const repliedSenderId = meta?.senderId || meta?.userId || meta?.fromId;
      return String(repliedSenderId) === String(myId) && String(m.senderId) !== String(myId);
    } catch {
      return false;
    }
  }

  function showReplyToast(m) {
    // лёгкая вибрация
    navigator.vibrate?.(20);

    // системное уведомление, если вкладка скрыта
    if (document.hidden && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        const n = new Notification(`Ответ от ${m.senderName || 'user'}`, {
          body: (m.text || 'Вложение'),
        });
        n.onclick = () => {
          window.location.href = `chat.html?jump=${encodeURIComponent(m._id)}`;
          n.close();
        };
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }

    // web-toast
    let wrap = document.getElementById('replyToastWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'replyToastWrap';
      wrap.style.position = 'fixed';
      wrap.style.right = '12px';
      wrap.style.top = '12px';
      wrap.style.zIndex = '9999';
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '8px';
      document.body.appendChild(wrap);
    }

    const el = document.createElement('div');
    el.style.background = '#0e1522';
    el.style.color = '#e6eef7';
    el.style.border = '1px solid #223147';
    el.style.borderRadius = '12px';
    el.style.padding = '10px 12px';
    el.style.boxShadow = '0 8px 24px rgba(0,0,0,.35)';
    el.style.maxWidth = '80vw';
    el.style.cursor = 'pointer';
    el.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px">Новый ответ</div>
      <div style="opacity:.9">${escapeHtml(m.senderName || 'user')}: ${escapeHtml(m.text || 'Вложение')}</div>
    `;
    el.onclick = () => {
      window.location.href = `chat.html?jump=${encodeURIComponent(m._id)}`;
    };
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // --- socket ---
  const socket = io('/', { auth: { token: token } });

  // Обработка новых сообщений
  socket.on('message:new', async (m) => {
    // Если открыт этот же чат — как раньше
    if (currentChat && String(m.chatId) === String(currentChat._id)) {
      messages.push(m);
      renderMessages();
      if (isNearBottom()) scrollToBottom();
      maybeMarkRead([m]);
      return;
    }

    // Иначе проверяем: это ответ мне? — показываем уведомление
    if (await isReplyToMe(m)) {
      showReplyToast(m);
    }
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
  socket.on('typing', ({ userId, isTyping }) => {
    if (els.tgSub) els.tgSub.textContent = isTyping ? 'печатает…' : '';
  });

  // --- composer ---
  if (els.msgInput) {
    els.msgInput.addEventListener('input', autoGrow);
  }
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

  // --- mark read ---
  function maybeMarkRead(newMsgs) {
    const ids = (newMsgs || messages)
      .filter((m) => String(m.senderId) !== String(myId))
      .map((m) => m._id);
    if (ids.length) socket.emit('message:read', { ids }, () => {});
  }

  // --- search ---
  let searchTimer;
  if (els.search) {
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
        const list = await API(`/search?chatId=${currentChat._id}&q=${encodeURIComponent(q)}`);
        messages = list;
        renderMessages();
      }, 300);
    });
  }

  // --- init ---
  loadChats();
})();