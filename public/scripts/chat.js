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
  let allChats = [];
  let loadingHistory = false;
  let atBottom = true;
  let typingTimeout = null;
  let replyTo = null;
  let pendingAttachments = [];

  // --- responsive: список -> чат ---
  const mqMobile = window.matchMedia('(max-width: 900px)');
  function enterChatView() {
    document.documentElement.classList.add('show-chat');
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
    allChats = Array.isArray(data) ? data : [];
    if (!els.list) return allChats;
    els.list.innerHTML = '';
    allChats.forEach((c) => {
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
    return allChats;
  }

  // --- header setter ---
  function setHeader(chat) {
    const title = (chat?.title || '').trim() || 'Чат';
    if (els.tgTitle) els.tgTitle.textContent = title;
    if (els.tgSub) els.tgSub.textContent = '';
    const img = els.tgAvatarImg;
    const letter = els.tgAvatarLetter;
    const firstChar = (title[0] || 'A').toUpperCase();
    if (img && letter) {
      if (chat?.avatar) {
        img.src = chat.avatar; img.style.display = 'block'; letter.style.display = 'none';
      } else {
        img.src = ''; img.style.display = 'none';
        letter.style.display = 'grid'; letter.textContent = firstChar;
      }
    }
  }

  // --- utils ---
  function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function truncate(s, n) { return (s || '').length > n ? s.slice(0, n - 1) + '…' : s; }
  function timeShort(t) { const d = new Date(t); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

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
          const pivot = new Date(new Date(meta.createdAt).getTime() + 1).toISOString();
          const q = new URLSearchParams({ chatId: currentChat._id, limit: 200, before: pivot });
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

  // --- render messages ---
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

      // свайп-вправо для ответа (только для чужих сообщений)
      if (div.classList.contains('their')) {
        let startX = 0, startY = 0, dx = 0, dy = 0, swiping = false;
        const threshold = 90;
        const maxPull = 140;

        div.addEventListener('touchstart', (e) => {
          if (e.touches.length !== 1) return;
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          dx = dy = 0;
          swiping = true;
          div.classList.add('is-swiping');
        }, { passive: true });

        div.addEventListener('touchmove', (e) => {
          if (!swiping) return;
          dx = e.touches[0].clientX - startX;
          dy = e.touches[0].clientY - startY;

          if (Math.abs(dy) > Math.abs(dx)) {
            swiping = false;
            div.style.transform = '';
            div.classList.remove('is-swiping', 'swipe-ready');
            return;
          }

          if (dx > 0) {
            e.preventDefault();
            const pull = Math.min(dx, maxPull);
            div.style.transform = `translateX(${pull}px)`;
            if (pull > threshold) {
              div.classList.add('swipe-ready');
            } else {
              div.classList.remove('swipe-ready');
            }
          }
        }, { passive: false });

        div.addEventListener('touchend', () => {
          if (!swiping) return;
          div.style.transform = '';
          div.classList.remove('is-swiping', 'swipe-ready');
          if (dx > threshold && Math.abs(dy) < 60) {
            setReply(m);
          }
          swiping = false;
        });

        div.addEventListener('touchcancel', () => {
          div.style.transform = '';
          div.classList.remove('is-swiping', 'swipe-ready');
          swiping = false;
        });
      }

      els.messages.appendChild(div);
    });

    if (prevIsNearBottom) scrollToBottom();
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

  // остальной код (отправка, сокеты, реакции и т.д.) оставляем без изменений
})();