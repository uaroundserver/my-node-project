// public/scripts/chat.js
(function () {
  // ===== helpers =====
  function buildHeaders(opts = {}) {
    const h = { ...(opts.headers || {}) };
    const token = localStorage.getItem('userToken');
    if (token) h.Authorization = 'Bearer ' + token;
    if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json';
    return h;
  }

  async function apiFetch(url, opts = {}) {
    try {
      const res = await fetch(url, { ...opts, headers: buildHeaders(opts) });
      const ct = res.headers.get('content-type') || '';
      const isJSON = ct.includes('application/json');
      const payload = isJSON ? await res.json().catch(() => null) : await res.text().catch(() => '');
      if (!res.ok) {
        const msg = (payload && payload.error) || (typeof payload === 'string' && payload) || res.statusText || 'Request failed';
        const err = new Error(msg);
        err.status = res.status;
        err.payload = payload;
        throw err;
      }
      return payload;
    } catch (e) {
      if (!(e instanceof Error)) e = new Error('Network error');
      if (e.status === 401) {
        localStorage.removeItem('userToken');
        location.href = 'login.html';
      }
      throw e;
    }
  }

  const API = (path, opts = {}) => apiFetch(`${location.origin.replace(/\/$/, '')}/api/chat` + path, opts);
  const API_ABS = (path, opts = {}) => apiFetch(path, opts);

  // ===== auth guard =====
  const token = localStorage.getItem('userToken');
  if (!token) { location.href = 'login.html'; return; }

  // ===== elements =====
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

    composer: document.querySelector('.composer'),
  };
  if (!els.search) els.search = document.getElementById('searchInput');

  const urlParams = new URLSearchParams(location.search);
  const jumpId = urlParams.get('jump');

  // ===== state =====
  let currentChat = null;
  let messages = [];
  let myId = null;
  let allChats = [];
  let loadingHistory = false;
  let atBottom = true;
  let typingTimeout = null;
  let replyTo = null;
  let pendingAttachments = [];

  // ===== small helpers =====
  function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function truncate(s, n) { return (s || '').length > n ? s.slice(0, n - 1) + '…' : s; }
  function timeShort(t) { const d = new Date(t); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function timeSmart(t) {
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() &&
                  d.getMonth() === now.getMonth() &&
                  d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  // вчера/не сегодня — покажем DD.MM, а время спрячем
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}
  // ===== reply bar anim prep =====
  if (els.replyBar) els.replyBar.classList.add('anim');

  // ===== layout switching =====
  function enterChatView() { document.documentElement.classList.add('show-chat'); }
  function leaveChatView() {
    document.documentElement.classList.remove('show-chat');
    currentChat = null;
    messages = [];
    els.messages && (els.messages.innerHTML = '');
    setHeader({ title: '', avatar: '' });
    if (els.search) els.search.value = '';
    clearReply();
    updateComposerPadding();
  }
  if (els.tgBack) els.tgBack.addEventListener('click', (e) => { e.preventDefault(); leaveChatView(); });

  // ===== dynamic bottom padding =====
  function updateComposerPadding() {
    if (!els.messages || !els.composer) return;
    const h = Math.ceil(els.composer.getBoundingClientRect().height || 0);
    els.messages.style.paddingBottom = (h + 8) + 'px';
  }
  if (window.ResizeObserver && els.composer) {
    const ro = new ResizeObserver(() => updateComposerPadding());
    ro.observe(els.composer);
  }
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', updateComposerPadding);
    visualViewport.addEventListener('scroll', updateComposerPadding);
  }
  window.addEventListener('orientationchange', updateComposerPadding);

  // ===== scroll helpers =====
  function isNearBottom() {
    const el = els.messages; if (!el) return true;
    const threshold = 120;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }
  function scrollToBottom() {
    if (!els.messages) return;
    els.messages.scrollTop = els.messages.scrollHeight - els.messages.clientHeight + 999;
  }

  // ===== profile =====
  apiFetch('/api/user/profile').then((u) => { myId = u._id || u.id; }).catch(() => {});

  // ===== chat list =====
  function renderChatsPlaceholder(message, retry) {
    if (!els.list) return;
    els.list.innerHTML = '';
    const li = document.createElement('li');
    li.style.listStyle = 'none';
    li.style.padding = '18px';
    li.style.color = '#90a4b4';
    li.innerHTML = `<div style="opacity:.9">${escapeHtml(message)}</div>`;
    if (retry) {
      const btn = document.createElement('button');
      btn.textContent = 'Обновить';
      btn.style.marginTop = '10px';
      btn.style.padding = '8px 12px';
      btn.style.background = '#0e1522';
      btn.style.color = '#e6eef7';
      btn.style.border = '1px solid #223147';
      btn.style.borderRadius = '10px';
      btn.onclick = () => loadChats();
      li.appendChild(btn);
    }
    els.list.appendChild(li);
  }

  async function loadChats() {
    try {
      renderChatsPlaceholder('Загрузка…');
      const data = await API('/chats');
      allChats = Array.isArray(data) ? data : [];
      if (!els.list) return allChats;

      els.list.innerHTML = '';
      if (!allChats.length) {
        renderChatsPlaceholder('Чатов пока нет', false);
        return allChats;
      }

      allChats.forEach((c) => {
  const firstChar = (c.title && c.title[0] ? c.title[0] : 'C').toUpperCase();
  const chatAvatarHtml = c.avatar
    ? `<img src="${c.avatar}" onerror="this.remove()" />`
    : `<span class="ava-letter">${firstChar}</span>`;

  const lm = c.lastMessage || null;
  const lastSenderName = lm?.senderName || 'user';
  const lastSenderAva  = lm?.senderAvatar || '';
  const lastText       = lm ? (lm.text || 'Вложение') : 'Нет сообщений';

  const miniAva = lastSenderAva
    ? `<img class="mini-ava" src="${lastSenderAva}" onerror="this.style.display='none'">`
    : `<span class="mini-ava mini-fallback">${(lastSenderName[0]||'?').toUpperCase()}</span>`;

  const lastTime = lm ? timeSmart(lm.createdAt) : '';

  const li = document.createElement('li');
  li.className = 'chat-item';
  li.innerHTML = `
    <div class="avatar">
      ${chatAvatarHtml}
      <span class="online" style="display:none"></span>
    </div>
    <div class="cmeta">
      <div class="crow">
        <div class="title">${escapeHtml(c.title || 'Чат')}</div>
        <div class="time">${lastTime}</div>
      </div>
      <div class="cpreview">
        ${miniAva}
        <span class="name">${escapeHtml(lastSenderName)}</span>
        <span class="sep">:</span>
        <span class="text">${escapeHtml(lastText)}</span>
        ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}
      </div>
    </div>`;
  li.onclick = () => openChat(c);
  els.list.appendChild(li);
});
      return allChats;
    } catch (e) {
      renderChatsPlaceholder('Не удалось загрузить список чатов', true);
      return [];
    }
  }

  // ===== header =====
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

  // ===== swipe-to-reply =====
  function attachSwipeToReply(el, onTrigger) {
    let startX = 0, startY = 0, dx = 0, dy = 0, active = false, ready = false, vibrated = false;
    const THRESHOLD = 38, CANCEL_V = 28, MAX_PULL = 64;

    function onStart(e) {
      const t = e.touches ? e.touches[0] : e;
      startX = t.clientX; startY = t.clientY; dx = 0; dy = 0;
      active = true; ready = false; vibrated = false;
      el.classList.add('is-swiping');
    }
    function onMove(e) {
      if (!active) return;
      const t = e.touches ? e.touches[0] : e;
      dx = t.clientX - startX; dy = Math.abs(t.clientY - startY);
      if (dy > CANCEL_V) { onEnd(); return; }
      if (dx > 0) {
        const pull = Math.min(dx, MAX_PULL);
        el.style.transform = `translateX(${pull}px)`;
        if (pull > THRESHOLD && !ready) {
          el.classList.add('swipe-ready'); ready = true;
          if (!vibrated && 'vibrate' in navigator) { navigator.vibrate(8); vibrated = true; }
        }
        if (pull <= THRESHOLD && ready) { el.classList.remove('swipe-ready'); ready = false; }
      }
    }
    function onEnd() {
      if (!active) return;
      active = false;
      el.style.transform = '';
      el.classList.remove('is-swiping');
      if (ready) {
        el.dataset.swipedAt = String(Date.now());
        el.classList.remove('swipe-ready');
        onTrigger && onTrigger();
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);

    // desktop drag
    let md = false;
    el.addEventListener('mousedown', (e) => { md = true; onStart(e); });
    window.addEventListener('mousemove', (e) => { if (md) onMove(e); });
    window.addEventListener('mouseup', () => { if (md) { md = false; onEnd(); } });
  }

  // ===== tap guard (не открывать меню при скролле / по цитате) =====
  function attachTapGuard(el, onTap) {
    const MOVE_GUARD = 8;
    const MAX_TAP_MS = 400;
    let startX=0, startY=0, startT=0, startScroll=0, moved=false, multiTouch=false;

    function getXY(ev) {
      if (ev.changedTouches && ev.changedTouches[0]) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
      if (ev.touches && ev.touches[0])       return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
      return { x: ev.clientX, y: ev.clientY };
    }
    function start(ev){
      // не открываем меню, если кликнули по ссылкам/инпутам/ЦИТАТЕ
      if (ev.target.closest('a, button, input, textarea, .reply')) return;
      const p = getXY(ev);
      startX = p.x; startY = p.y; startT = Date.now();
      startScroll = els.messages ? els.messages.scrollTop : 0;
      moved = false; multiTouch = !!(ev.touches && ev.touches.length > 1);
    }
    function move(ev){
      if (multiTouch) { moved = true; return; }
      const p = getXY(ev);
      const dx = Math.abs(p.x - startX);
      const dy = Math.abs(p.y - startY);
      const sc = els.messages ? Math.abs((els.messages.scrollTop) - startScroll) : 0;
      if (dx > MOVE_GUARD || dy > MOVE_GUARD || sc > 2) moved = true;
    }
    function end(ev){
      if (multiTouch) return;
      // если палец отпустили над цитатой — это не «тап по пузырю»
      if (ev.target && ev.target.closest('.reply')) return;

      move(ev);
      const dur = Date.now() - startT;
      if (moved || dur > MAX_TAP_MS) return;
      const sw = Number(el.dataset.swipedAt || 0);
      if (sw && Date.now() - sw < 250) return;

      let { x, y } = getXY(ev);
      if (x == null || y == null || (x === 0 && y === 0)) {
        const r = el.getBoundingClientRect(); x = r.left + r.width/2; y = r.top + r.height/2;
      }
      onTap(x, y, ev);
    }
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove',  move,  { passive: true });
    el.addEventListener('touchend',   end);
    el.addEventListener('touchcancel',()=>{ moved=true; });
    el.addEventListener('mousedown', (e)=>{
      start(e);
      const up = (ev)=>{ end(ev); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  // ===== open chat =====
  async function openChat(c) {
    currentChat = c;
    setHeader(c);

    if (els.messages) els.messages.innerHTML = '';
    messages = [];
    enterChatView();
    await loadHistory();
    updateComposerPadding();
    scrollToBottom();

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
            target.classList.add('highlight');
            setTimeout(() => target.classList.remove('highlight'), 1500);
          } else {
            scrollToBottom();
          }
        }
      } catch {}
    }
  }

  // Открыть чат по messageId
  async function openChatByMessageId(messageId) {
    try {
      const meta = await API_ABS(`/api/chat/message/${encodeURIComponent(messageId)}`);
      const chatId =
        meta?.chatId || meta?.chat_id || meta?.chat?.id || meta?.chat?.ID ||
        meta?.chat?._id || meta?.chat?._ID || meta?.chat || meta?.roomId || meta?.room_id || null;
      if (!chatId) return;

      if (!allChats || !allChats.length) await loadChats();
      let chat = allChats.find(c => String(c._id) === String(chatId));
      if (!chat) chat = { _id: chatId, title: meta?.chatTitle || meta?.title || 'Чат', avatar: meta?.chatAvatar || '' };

      enterChatView();
      await openChat(chat);
    } catch {}
  }

  // ===== history / infinite scroll up =====
  async function loadHistory(before) {
    if (!currentChat || loadingHistory) return;
    loadingHistory = true;
    if (before) showTopLoader(true);
    try {
      const q = new URLSearchParams({ chatId: currentChat._id, limit: 30 });
      if (before) q.set('before', before);
      const history = await API('/messages?' + q.toString());
      messages = before ? history.concat(messages) : history;
      renderMessages();
      updateComposerPadding();
    } catch (e) {
      // noop
    } finally {
      loadingHistory = false;
      if (before) showTopLoader(false);
    }
  }

  function showTopLoader(show){
    if (!els.messages) return;
    let t = els.messages.querySelector('.top-loader');
    if (show){
      if (!t){
        t = document.createElement('div');
        t.className = 'top-loader';
        t.innerHTML = '<div class="spinner"></div>';
        els.messages.prepend(t);
      }
    } else if (t) { t.remove(); }
  }

  els.messages && els.messages.addEventListener('scroll', () => {
    const el = els.messages;
    atBottom = isNearBottom();
    if (el.scrollTop === 0 && messages.length) loadHistory(messages[0].createdAt);
  });

  // ===== render messages =====
  function renderMessages() {
    if (!els.messages) return;
    const prevIsNearBottom = isNearBottom();
    els.messages.innerHTML = '';

    messages.forEach((m) => {
      const div = document.createElement('div');
      const isMine = String(m.senderId || m.userId) === String(myId);
      const newClass = m._justAdded ? ' msg--new' : '';
      div.className = 'msg ' + (isMine ? 'mine' : 'their') + newClass;
      div.dataset.id = m._id;

      // reply preview
      let replyHtml = '';
      function renderReplyPreview(src) {
        if (!src) return '';
        const who = String(src.senderId || src.userId) === String(myId) ? 'Вы' : (src.senderName || 'user');
        const hasAtt = src.attachments && src.attachments.length;
        const file = hasAtt ? src.attachments[0] : null;
        let icon = '';
        if (file) {
          const mtyp = (file.mime || file.mimetype || '').toLowerCase();
          if (mtyp.startsWith('image/')) icon = '🖼️';
          else if (mtyp.startsWith('video/')) icon = '🎞️';
          else if (mtyp.startsWith('audio/')) icon = '🎵';
          else icon = '📎';
        }
        const snipText = (src.text && src.text.trim())
          ? escapeHtml(src.text.trim())
          : (file ? (escapeHtml(file.originalName || file.originalname || '') || '(вложение)') : '');
        const nested = src.reply ? `<span class="reply-nested">${renderReplyPreview(src.reply)}</span>` : '';
        const ava = src.senderAvatar
  ? `<img src="${src.senderAvatar}" class="reply-ava"
       width="16" height="16"
       style="width:16px;height:16px;flex:0 0 16px;border-radius:50%;
              object-fit:cover;vertical-align:-3px;margin-right:6px;
              outline:1px solid rgba(255,255,255,.1)" />`
  : '';
        return `${ava}<b>${escapeHtml(who)}</b>: ${icon ? `<span class="reply-ico">${icon}</span>` : ''}${snipText}${nested}`;
      }
      {
        const src = m.reply || messages.find((x) => String(x._id) === String(m.replyTo));
        if (src) replyHtml = `<div class="reply" data-reply-id="${src._id}">${renderReplyPreview(src)}</div>`;
      }

      // attachments
      const attachHtml = (m.attachments || [])
        .map((a) => {
          const mime = (a.mime || a.mimetype || '').toLowerCase();
          const url = a.url || a.href || '';
          const oname = a.originalName || a.originalname || 'Файл';
          if (mime.startsWith('image/')) return `<div class="attach"><img src="${url}" style="max-width:240px;max-height:180px;border-radius:10px"/></div>`;
          if (mime.startsWith('video/')) return `<div class="attach"><video src="${url}" controls style="max-width:260px;max-height:200px;border-radius:10px"></video></div>`;
          return `<a class="attach" href="${url}" target="_blank">${escapeHtml(oname)}</a>`;
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
          ${isMine ? `<span class="ticks" title="Доставлено/Прочитано">✓✓</span>` : ''}
          ${reactionsHtml ? `<span>${reactionsHtml}</span>` : ''}
        </div>
      `;

      // ПК: контекстное меню
      div.oncontextmenu = (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, m); };

      // Тап/клик — только по самому пузырю (цитату игнорим)
      attachTapGuard(div, (x, y) => showContextMenu(x, y, m));

      // свайп-вправо → ответ
      attachSwipeToReply(div, () => setReply(m));

      // переход по цитате — с отменой всплытия
      const rEl = div.querySelector('.reply');
      if (rEl && rEl.dataset.replyId) {
        const go = (e) => {
          e.stopPropagation();
          if (e.cancelable) e.preventDefault();
          jumpToMessage(rEl.dataset.replyId);
        };
        rEl.addEventListener('click', go);
        rEl.addEventListener('touchend', go, { passive: false });
      }

      els.messages.appendChild(div);
      if (m._justAdded) m._justAdded = false;
    });

    if (prevIsNearBottom) scrollToBottom();
    updateComposerPadding();
  }

  // ===== context menu =====
  let ctx = null, onWinClick = null, onWinTouch = null;
  function showContextMenu(x, y, m) {
    hideContextMenu();
    ctx = document.createElement('div');
    ctx.id = 'msgContextMenu';
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
    ctx.addEventListener('click', (e) => e.stopPropagation());
    ctx.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    const mine = String(m.senderId || m.userId) === String(myId);
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
      b.onclick = (ev) => { fn(ev); hideContextMenu(); };
      ctx.appendChild(b);
    };
    mk('Ответить', () => setReply(m));
    mk('👍 Реакция', (ev) => {
      const rect = ctx.getBoundingClientRect();
      const ex = (ev && ev.clientX) || (rect.left + 20);
      const ey = (ev && ev.clientY) || (rect.top + 20);
      react(m, '👍', ex, ey);
    });
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
    onWinClick = (ev) => { if (!ctx.contains(ev.target)) hideContextMenu(); };
    onWinTouch = (ev) => { if (!ctx.contains(ev.target)) hideContextMenu(); };
    window.addEventListener('click', onWinClick);
    window.addEventListener('touchstart', onWinTouch, { passive: true });
  }
  function hideContextMenu() {
    if (ctx) { ctx.remove(); ctx = null; }
    if (onWinClick) { window.removeEventListener('click', onWinClick); onWinClick = null; }
    if (onWinTouch) { window.removeEventListener('touchstart', onWinTouch); onWinTouch = null; }
  }

  // «салют» из эмодзи
  function emojiBurst(x, y, emoji='👍'){
    const b = document.createElement('div');
    b.className = 'emoji-burst';
    b.textContent = emoji;
    b.style.left = x + 'px';
    b.style.top  = y + 'px';
    document.body.appendChild(b);
    b.addEventListener('animationend', () => b.remove());
  }

  function react(m, emoji='👍', x, y) {
    socket.emit('message:react', { id: m._id, emoji }, (ack) => {
      if (ack?.ok && typeof x === 'number' && typeof y === 'number') emojiBurst(x, y, emoji);
      if (!ack?.ok) ackHandler(ack);
    });
  }

  // ===== keep keyboard open & close only on outside tap =====
  if (els.sendBtn) {
    // кнопка не забирает фокус и не триггерит скрытие клавиатуры
    els.sendBtn.setAttribute('type', 'button');
    els.sendBtn.setAttribute('tabindex', '-1');
    els.sendBtn.addEventListener('mousedown', (e) => e.preventDefault());
    els.sendBtn.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });

    // надёжная отправка для desktop и iOS
    const triggerSend = (e) => { e.preventDefault(); send(); };
    els.sendBtn.addEventListener('click', triggerSend);
    els.sendBtn.addEventListener('touchend', triggerSend, { passive: false });
  }

  // закрывать клавиатуру только при тапе вне композера
  function maybeBlurOnOutsideTap(ev) {
    if (!els.msgInput) return;
    if (ev.target.closest('.composer')) return;
    if (document.activeElement === els.msgInput) els.msgInput.blur();
  }
  document.addEventListener('click', maybeBlurOnOutsideTap);
  document.addEventListener('touchend', maybeBlurOnOutsideTap, { passive: true });

  // ===== jump helper =====
  async function jumpToMessage(id) {
    if (!currentChat) { window.location.href = `chat.html?jump=${encodeURIComponent(id)}`; return; }
    try {
      const meta = await API_ABS(`/api/chat/message/${encodeURIComponent(id)}`);
      const targetTime = new Date(meta.createdAt).getTime();
      let guard = 0;
      while (guard < 40) {
        const el = els.messages && els.messages.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (el) {
          el.classList.add('highlight');
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => el.classList.remove('highlight'), 1600);
          return;
        }
        if (!messages.length) break;
        const firstTime = new Date(messages[0].createdAt).getTime();
        if (firstTime <= targetTime) break;
        await loadHistory(messages[0].createdAt);
        guard++;
      }
      const el2 = els.messages && els.messages.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (el2) {
        el2.classList.add('highlight');
        el2.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => el2.classList.remove('highlight'), 1600);
        return;
      }
      window.location.href = `chat.html?jump=${encodeURIComponent(id)}`;
    } catch {
      window.location.href = `chat.html?jump=${encodeURIComponent(id)}`;
    }
  }

  // ===== reply helpers =====
  function setReply(m) {
    replyTo = m;
    if (els.replyBar) {
      if (els.replyBar.hasAttribute('hidden')) els.replyBar.removeAttribute('hidden');
      els.replyBar.classList.add('anim');
      requestAnimationFrame(() => els.replyBar.classList.add('visible'));
      els.replyText && (els.replyText.textContent = (m.text || '(вложение)').slice(0, 140));
    }
    els.msgInput && els.msgInput.focus();
    setTimeout(updateComposerPadding, 0);
  }
  function clearReply() {
    replyTo = null;
    if (!els.replyBar) return;
    els.replyBar.classList.remove('visible');
    setTimeout(() => {
      if (!els.replyBar.classList.contains('visible')) {
        els.replyBar.setAttribute('hidden', 'hidden');
      }
      updateComposerPadding();
    }, 220);
  }
  els.replyCancel && (els.replyCancel.onclick = clearReply);

  // ===== attachments =====
  els.attachBtn && (els.attachBtn.onclick = () => els.fileInput.click());
  if (els.fileInput) {
    els.fileInput.onchange = async () => {
      const fd = new FormData();
      [...els.fileInput.files].forEach((f) => fd.append('files', f));
      const res = await apiFetch('/api/chat/attachments', { method: 'POST', body: fd });
      pendingAttachments = res.files || [];
    };
  }

  // ===== notifications =====
  async function isReplyToMe(m) {
    try {
      if (!m?.replyTo) return false;
      const meta = await API_ABS(`/api/chat/message/${encodeURIComponent(m.replyTo)}`);
      const repliedSenderId = meta?.senderId || meta?.userId || meta?.fromId;
      return String(repliedSenderId) === String(myId) && String(m.senderId || m.userId) !== String(myId);
    } catch { return false; }
  }

  function showReplyToast(m) {
    navigator.vibrate?.(20);
    if (document.hidden && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        const n = new Notification(`Ответ от ${m.senderName || 'user'}`, { body: (m.text || 'Вложение') });
        n.onclick = () => { window.location.href = `chat.html?jump=${encodeURIComponent(m._id)}`; n.close(); };
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
    let wrap = document.getElementById('replyToastWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'replyToastWrap';
      wrap.style.position = 'fixed'; wrap.style.right = '12px'; wrap.style.top = '12px';
      wrap.style.zIndex = '9999'; wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.gap = '8px';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.style.background = '#0e1522'; el.style.color = '#e6eef7';
    el.style.border = '1px solid #223147'; el.style.borderRadius = '12px';
    el.style.padding = '10px 12px'; el.style.boxShadow = '0 8px 24px rgba(0,0,0,.35)';
    el.style.maxWidth = '80vw'; el.style.cursor = 'pointer';
    el.innerHTML = `<div style="font-weight:700;margin-bottom:4px">Новый ответ</div>
                    <div style="opacity:.9">${escapeHtml(m.senderName || 'user')}: ${escapeHtml(m.text || 'Вложение')}</div>`;
    el.onclick = () => { window.location.href = `chat.html?jump=${encodeURIComponent(m._id)}`; };
    wrap.appendChild(el);
    setTimeout(() => { el.classList?.add('toast-hide'); setTimeout(() => el.remove(), 220); }, 4800);
  }

  // ===== socket =====
  const socket = io('/', { auth: { token: token } });

  socket.on('message:new', async (m) => {
    if (currentChat && String(m.chatId) === String(currentChat._id)) {
      m._justAdded = true;
      messages.push(m);
      renderMessages();
      if (isNearBottom()) scrollToBottom();
      maybeMarkRead([m]);
      return;
    }
    if (await isReplyToMe(m)) showReplyToast(m);
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
    if (!els.tgSub) return;
    els.tgSub.innerHTML = isTyping ? 'печатает<span class="typing-dots"><i></i><i></i><i></i></span>' : '';
  });

  // ===== composer =====
  if (els.msgInput) els.msgInput.addEventListener('input', autoGrow);
  function autoGrow() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 160) + 'px';
    updateComposerPadding();
    socket.emit('typing', { isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('typing', { isTyping: false }), 1500);
  }

  function ackHandler(res) { if (!res?.ok) alert(res?.error || 'Ошибка'); }

  // НЕ навешиваем els.sendBtn.onclick = send; — используем click/touchend выше

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
        updateComposerPadding();

        // держим клавиатуру открытой: сразу вернуть фокус
        requestAnimationFrame(() => {
          els.msgInput.focus();
          try { els.msgInput.setSelectionRange(els.msgInput.value.length, els.msgInput.value.length); } catch {}
        });

        setTimeout(scrollToBottom, 0);
      } else {
        alert(ack?.error || 'Не отправлено');
      }
    });
  }

  // ===== mark read =====
  function maybeMarkRead(newMsgs) {
    const ids = (newMsgs || messages)
      .filter((m) => String(m.senderId || m.userId) !== String(myId))
      .map((m) => m._id);
    if (ids.length) socket.emit('message:read', { ids }, () => {});
  }

  // ===== search =====
  let searchTimer;
  if (els.search) {
    els.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        if (!currentChat) return;
        const q = els.search.value.trim();
        if (!q) {
          messages = await API('/messages?' + new URLSearchParams({ chatId: currentChat._id, limit: 30 }));
          renderMessages();
          return;
        }
        const list = await API(`/search?chatId=${currentChat._id}&q=${encodeURIComponent(q)}`);
        messages = list;
        renderMessages();
      }, 300);
    });
  }

  // ===== init =====
  (async () => {
    await loadChats();
    updateComposerPadding();
    if (jumpId) openChatByMessageId(jumpId);
  })();

})();