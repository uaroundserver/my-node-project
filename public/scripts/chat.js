// public/scripts/chat.js
(function () {
// ===== virtualization settings =====
let virtualRowHeight = 80;
let visibleBuffer = 8;

  function escapeHtml(s){return (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function renderMessageHtml(m){
    const mine = String(m.senderId || m.userId) === String(myId);
    const text = escapeHtml(m.text || '');
    // Простейший шаблон. Если у тебя был свой шаблон (аватарки, реплаи, вложения) — можно подставить сюда.
    return `<div class="msg ${mine ? 'mine' : 'their'}"><div class="mtext">${text}</div></div>`;
  }

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
      if (!res.ok) {
        let msg = 'Request failed';
        try {
          if (ct.includes('application/json')) {
            const j = await res.json();
            msg = j?.error || j?.message || msg;
          } else {
            msg = await res.text();
          }
        } catch {}
        throw new Error(msg);
      }
      if (ct.includes('application/json')) return res.json();
      return res.text();
    } catch (e) {
      throw e;
    }
  }
  const API = (path, opts) => apiFetch(`/api/chat` + path, opts);
  const API_ABS = (path, opts) => apiFetch(`${(window.SERVER_URL||'').replace(/\/$/,'')}/api/chat` + path, opts);

  // ===== state =====
  let els = {};
  let currentChat = null;
  let messages = [];
  let myId = null;
  let loadingHistory = false;
  let jumpId = null;
  let atBottom = true;

  function $(sel, root=document) { return root.querySelector(sel); }
  function $all(sel, root=document) { return [...root.querySelectorAll(sel)]; }

  // ===== elements =====
  document.addEventListener('DOMContentLoaded', () => {
    els.messages = $('.messages');        // контейнер чата (overflow: auto)
    els.search   = $('.chat-search input');
    els.header   = $('.chat-header');
    els.input    = $('.chat-input textarea');
    els.sendBtn  = $('.chat-input .send-btn');
    // ... остальные, если есть
  });

  // ===== UI helpers =====
  function setHeader(c) {
    if (!els.header || !c) return;
    els.header.querySelector('.title').textContent = c.title || 'Chat';
  }

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
  (async function loadProfile(){
    try {
      const prof = await apiFetch('/api/users/me', { method: 'GET' });
      if (prof?._id) myId = prof._id;
    } catch {}
  })();

  // ===== chats =====
  async function loadChats() {
    const list = await API('/chats');
    if (list && list.length) {
      await openChat(list[0]);
    }
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
        const target = els.messages && els.messages.querySelector(`[data-id="${CSS.escape(jumpId)}"]`);
        if (target) {
          target.scrollIntoView({ block: 'center' });
          target.classList.add('highlight');
          setTimeout(() => target.classList.remove('highlight'), 1500);
        } else {
          scrollToBottom();
        }
      } catch {}
    }
  }
  // Открыть чат по messageId
  async function openChatByMessageId(messageId) {
    try {
      const meta = await API_ABS(`/message/${encodeURIComponent(messageId)}`);
      if (!meta?.createdAt) return;
      jumpId = messageId;
      if (!currentChat) {
        await loadChats();
      } else {
        await openChat(currentChat);
      }
    } catch {}
  }

  // ===== history (всё за раз) =====
  async function loadHistory(before) {
    if (!currentChat || loadingHistory) return;
    loadingHistory = true;
    if (before) showTopLoader(true);
    try {
      const q = new URLSearchParams({ chatId: currentChat._id });
      const history = await API('/messages?' + q.toString());
      messages = history;
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
        t.style.position = 'absolute';
        t.style.top = '0';
        t.style.left = '0';
        t.style.right = '0';
        t.style.height = '24px';
        els.messages.prepend(t);
      }
    } else if (t) { t.remove(); }
  }

  // ===== виртуализированный рендер =====
  function renderMessages() {
    if (!els.messages) return;
    const container = els.messages;
    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;

    // создать spacer/wrapper единожды
    if (!container._virtualWrapper) {
      container.innerHTML = '';
      const spacer = document.createElement('div');
      spacer.style.height = `${messages.length * virtualRowHeight}px`;
      spacer.style.position = 'relative';

      const wrapper = document.createElement('div');
      wrapper.style.position = 'absolute';
      wrapper.style.top = '0';
      wrapper.style.left = '0';
      wrapper.style.right = '0';

      spacer.appendChild(wrapper);
      container.appendChild(spacer);
      container._virtualWrapper = wrapper;
      container._virtualSpacer = spacer;
    } else {
      // обновить высоту при изменении количества сообщений
      container._virtualSpacer.style.height = `${messages.length * virtualRowHeight}px`;
    }

    const total = messages.length;
    const startIndex = Math.max(0, Math.floor(scrollTop / virtualRowHeight) - visibleBuffer);
    const endIndex = Math.min(total, Math.ceil((scrollTop + viewportHeight) / virtualRowHeight) + visibleBuffer);

    const wrapper = container._virtualWrapper;
    const offsetY = startIndex * virtualRowHeight;
    wrapper.style.transform = `translateY(${offsetY}px)`;

    // перерисовать видимый срез
    wrapper.innerHTML = '';
    for (let i = startIndex; i < endIndex; i++) {
      const m = messages[i];
      const div = document.createElement('div');
      div.className = 'message';
      div.dataset.id = m._id;
      // фиксированная минимальная высота «строки»
      div.style.minHeight = `${virtualRowHeight}px`;
      div.innerHTML = renderMessageHtml(m);
      wrapper.appendChild(div);
    }
  }

  // ===== scroll / viewport =====
  function updateComposerPadding() {
    // если у тебя есть фиксированный composer снизу — обновляй отступы под него
  }

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', updateComposerPadding);
    visualViewport.addEventListener('scroll', updateComposerPadding);
  }
  window.addEventListener('orientationchange', updateComposerPadding);

  // Пересчитываем только видимую часть при скролле
  els.messages && els.messages.addEventListener('scroll', () => {
    const el = els.messages;
    atBottom = isNearBottom();
    // Lazy load отключён, просто перерисовываем срез
    renderMessages();
  });

  // ===== отправка сообщений (как было) =====
  async function sendMessage() {
    if (!els.input || !currentChat) return;
    const text = (els.input.value || '').trim();
    if (!text) return;
    els.input.value = '';
    try {
      const fd = new FormData();
      fd.set('chatId', currentChat._id);
      fd.set('text', text);
      await API('/send', { method: 'POST', body: fd });
      // Дальнейшее обновление приходит по сокету; если нет — можно пушнуть локально
    } catch (e) {
      console.error(e);
    }
  }

  if (els.sendBtn) els.sendBtn.addEventListener('click', sendMessage);
  if (els.input) els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  
    // ===== socket.io =====
  let socket;
  function connectSocket() {
    if (socket) try { socket.close(); } catch {}
    // глобально доступный io() должен быть подключен в HTML
    socket = io(window.SERVER_URL || undefined, { transports: ['websocket'] });
    const token = localStorage.getItem('userToken');
    if (token) socket.emit('auth', token);

    socket.on('connect', () => {});
    socket.on('disconnect', () => {});

    socket.on('message', (payload) => {
      if (payload?.type === 'message' && payload?.data) {
        const m = payload.data;
        // если это наш текущий чат
        if (String(m.chatId) === String(currentChat?._id)) {
          messages.push(m);
          if (atBottom) {
            // прокрутим вниз и дорендерим
            scrollToBottom();
          }
          renderMessages();
        }
      }
    });
  }
  connectSocket();

  // ===== поиск =====
  let searchTimer;
  if (els.search) {
    els.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        if (!currentChat) return;
        const q = els.search.value.trim();
        if (!q) {
          messages = await API('/messages?' + new URLSearchParams({ chatId: currentChat._id }));
          renderMessages();
          return;
        }
        // Если у тебя есть отдельный /search — можно использовать его и заполнить messages результатом
        try {
          const list = await API(`/search?chatId=${currentChat._id}&q=${encodeURIComponent(q)}`);
          messages = list;
          renderMessages();
        } catch (e) {
          // если нет /search — можно сделать локальный фильтр:
          // messages = messages.filter(m => (m.text||'').toLowerCase().includes(q.toLowerCase()));
          // renderMessages();
        }
      }, 300);
    });
  }

  // ===== навигация по messageId =====
  async function jumpToMessage(id) {
    // так как вся история уже загружена, просто найдём элемент, иначе — приблизим позицию
    const container = els.messages;
    if (!container) return;
    const idx = messages.findIndex(m => String(m._id) === String(id));
    if (idx === -1) return;

    // выставим scrollTop приблизительно по индекс/высота
    container.scrollTop = Math.max(0, idx * virtualRowHeight - (container.clientHeight/2));
    renderMessages();
    // попробуем подсветить уже отрисованный элемент
    setTimeout(() => {
      const target = container.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (target) {
        target.classList.add('highlight');
        setTimeout(() => target.classList.remove('highlight'), 1500);
      }
    }, 0);
  }
  
    // ===== misc/ui (жесты и т.д. остаются как были, если они у тебя есть) =====
  function enterChatView(){ /* no-op */ }

  // ===== init =====
  (async () => {
    await loadChats();
    updateComposerPadding();
    if (jumpId) openChatByMessageId(jumpId);
  })();

})();
  