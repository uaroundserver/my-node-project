function initMenu() {
  if (window.__menu_inited) return;
  window.__menu_inited = true;

  // === Мобильная консоль (Eruda) — включается по ?debug=1 / #debug / localStorage.DEBUG_ERUDA="1"
  // и долгим тапом (1.2с) по иконке чата в шапке.
  (async function setupEruda() {
    function needEruda() {
      const q = location.search + location.hash;
      return /\bdebug=1\b|\beruda=1\b/i.test(q) || localStorage.getItem('DEBUG_ERUDA') === '1';
    }
    async function loadEruda() {
      if (window.eruda) return;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/eruda@3/eruda.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      try { window.eruda && window.eruda.init(); window.eruda && window.eruda.show(); } catch {}
    }
    if (needEruda()) { try { await loadEruda(); } catch {} }
    const setupLongPress = () => {
      const icon = document.getElementById('chatHeaderIcon');
      if (!icon) return;
      let t = null;
      const start = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          try {
            if (!window.eruda) await loadEruda();
            if (window.eruda) {
              const isShown = window.eruda._isShow && window.eruda._isShow();
              if (isShown) window.eruda.hide(); else window.eruda.show();
            }
          } catch {}
        }, 1200);
      };
      const cancel = () => clearTimeout(t);
      icon.addEventListener('touchstart', start, { passive: true });
      icon.addEventListener('touchend', cancel, { passive: true });
      icon.addEventListener('touchcancel', cancel, { passive: true });
      icon.addEventListener('mousedown', start);
      icon.addEventListener('mouseup', cancel);
      icon.addEventListener('mouseleave', cancel);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupLongPress);
    } else {
      setupLongPress();
    }
  })();

  // ⬇️ Подтягиваем socket.io, если меню вставлено через innerHTML и тег <script> из menu.html не выполнился
  async function ensureSocketIO(){
    if (window.io) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function sidebar() { return document.getElementById('sidebar'); }
  function backdrop() { return document.getElementById('menu-backdrop'); }
  function menuBtn()  { return document.getElementById('menuButton'); }

  let scrollLockY = 0;
  let isOpen = false;
  let canAutoClose = false;

  function lockScroll() {
    scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollLockY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.documentElement.classList.add('no-scroll');
  }

  function unlockScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.documentElement.classList.remove('no-scroll');
    window.scrollTo(0, scrollLockY);
  }

  function addAutoCloseListeners() {
    const closeOnMove = () => { if (isOpen && canAutoClose) closeSidebar(); };
    addAutoCloseListeners._refs = [
      ['scroll', window, closeOnMove, { passive:true }],
      ['wheel', window, closeOnMove, { passive:true }],
      ['touchmove', window, closeOnMove, { passive:true }],
      ['scroll', document, closeOnMove, { passive:true }],
      ['touchmove', document.body, closeOnMove, { passive:true }],
      ['resize', window, closeOnMove],
      ['orientationchange', window, closeOnMove],
    ];
    addAutoCloseListeners._refs.forEach(([ev, target, fn, opt]) => target.addEventListener(ev, fn, opt));
  }

  function removeAutoCloseListeners() {
    (addAutoCloseListeners._refs || []).forEach(([ev, target, fn, opt]) => {
      target.removeEventListener(ev, fn, opt);
    });
    addAutoCloseListeners._refs = [];
  }

  function openSidebar() {
    if (!sidebar()) return;
    sidebar().classList.add('active');

    if (backdrop()) {
      backdrop().hidden = false;
      requestAnimationFrame(() => backdrop().classList.add('active'));
    }

    lockScroll();
    if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'true');
    isOpen = true;

    addAutoCloseListeners();

    canAutoClose = false;
    setTimeout(() => { canAutoClose = true; }, 250);
  }

  function closeSidebar() {
    if (!sidebar()) return;

    sidebar().classList.remove('active');

    if (backdrop()) {
      backdrop().classList.remove('active');
      setTimeout(() => { if (backdrop()) backdrop().hidden = true; }, 300);
    }

    if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'false');
    unlockScroll();

    isOpen = false;
    canAutoClose = false;
    removeAutoCloseListeners();
  }

  function toggleSidebar() { isOpen ? closeSidebar() : openSidebar(); }
  window.toggleSidebar = toggleSidebar;

  // --- Выход (гарантированный)
  function fallbackLogout() {
    try {
      localStorage.removeItem('userToken');
      localStorage.removeItem('userData');
    } catch (_) {}
    window.location.href = 'login.html';
  }

  function handleLogoutClick(e) {
    e.preventDefault();
    e.stopPropagation();
    (window.logout || fallbackLogout)();
  }

  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.js-logout, [data-logout], [onclick="logout()"]');
    if (!btn) return;
    handleLogoutClick(e);
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.js-logout, [data-logout], [onclick="logout()"]');
    if (!btn) return;
    handleLogoutClick(e);
  });

  // --- Закрытие при клике на ссылку внутри сайдбара
  document.addEventListener('click', e => {
    if (e.target.closest('#sidebar a')) closeSidebar();
  });

  // --- Закрытие при тапе по бэкдропу
  document.addEventListener('pointerdown', e => {
    if (!isOpen) return;
    if (backdrop() && (e.target === backdrop() || e.target.id === 'menu-backdrop')) closeSidebar();
  });

  // --- Закрытие при тапе в любое место вне меню (capture)
  document.addEventListener('pointerdown', e => {
    if (!isOpen) return;
    if (e.target.closest('#sidebar') || e.target.closest('#menuButton')) return;
    closeSidebar();
  }, true);

  // --- Закрытие по Esc
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) closeSidebar();
  });

  // --- Подсветка активных ссылок
  (function setActiveLinks() {
    const path = location.pathname.split('/').pop() || 'home.html';
    const links = document.querySelectorAll('#bottom-nav a, #sidebar a');
    links.forEach(a => {
      try {
        const href = a.getAttribute('href') || '';
        const file = href.split('?')[0].split('#')[0];
        if (file && path === file) a.classList.add('active');
      } catch(_) {}
    });
  })();

  // === Бэйдж уведомлений чата ===
  window.updateChatBadge = function(n){
    const headerBadge = document.getElementById('chatBadgeHeader');
    const show = Number(n) > 0;
    if (headerBadge) {
      headerBadge.textContent = n > 99 ? '99+' : `+${n}`;
      headerBadge.style.display = show ? 'inline-block' : 'none';
    }
  };

  // --- Восстановить счётчик при загрузке страницы
  (function restoreChatBadge(){
    const n = Number(sessionStorage.getItem('chatBadgeCount') || '0');
    updateChatBadge(n);
  })();

  // Если мы в чате — сбросить бэйдж
  (function(){
    const file = (location.pathname.split('/').pop() || '').toLowerCase();
    if (file === 'chat.html') {
      sessionStorage.setItem('chatBadgeCount', '0');
      updateChatBadge(0);
    }
  })();

  // ===== Реалтайм-уведомления: инкремент ТОЛЬКО если это ответ на МЕНЯ =====
  (async function initChatNotifications(){
    try {
      const token = localStorage.getItem('userToken');
      if (!token) return;
      if (window.__notifSocket) return; // не плодим соединения

      // мой id
      let myId = null;
      try {
        const me = await fetch('/api/user/profile', {
          headers: { Authorization: 'Bearer ' + token }
        }).then(r => r.ok ? r.json() : null);
        myId = me?._id || me?.id || null;
      } catch {}
      if (!myId) return;

      // КЕШ для replyTo → senderId исходного сообщения (LRU-подобный, с пределом)
      const replyMetaCache = new Map(); // key: messageId, value: { ownerId, ts }
      const CACHE_LIMIT = 200;
      function cacheSet(id, ownerId){
        replyMetaCache.set(String(id), { ownerId, ts: Date.now() });
        if (replyMetaCache.size > CACHE_LIMIT) {
          // удалить самый старый
          let oldestK=null, oldestV=Infinity;
          replyMetaCache.forEach((v,k)=>{ if(v.ts<oldestV){oldestV=v.ts; oldestK=k;} });
          if (oldestK) replyMetaCache.delete(oldestK);
        }
      }
      function cacheGet(id){
        const x = replyMetaCache.get(String(id));
        return x ? x.ownerId : null;
      }

      async function getOwnerOfMessage(msgId) {
        const cached = cacheGet(msgId);
        if (cached) return cached;
        try {
          const meta = await fetch(`/api/chat/message/${encodeURIComponent(msgId)}`, {
            headers: { Authorization: 'Bearer ' + token }
          }).then(r => r.ok ? r.json() : null);
          const owner = meta?.senderId || meta?.userId || meta?.fromId || null;
          if (owner) cacheSet(msgId, owner);
          return owner;
        } catch { return null; }
      }

      // Быстрая проверка "ответ на меня"
      async function isReplyToMeSmart(m) {
        // свои сообщения не считаем
        if (m?.senderId && String(m.senderId) === String(myId)) return false;

        // 1) Сервер дал явный owner id
        if (m?.replyToOwnerId) {
          return String(m.replyToOwnerId) === String(myId);
        }

        // 2) Есть replyTo — узнаём владельца исходного
        if (m?.replyTo) {
          const ownerId = await getOwnerOfMessage(m.replyTo);
          if (ownerId) return String(ownerId) === String(myId);
        }

        // 3) (необязательно) если есть mentions и там есть я — можно засчитать как «ответ»
        if (Array.isArray(m?.mentions) && m.mentions.some(x => String(x) === String(myId))) {
          return true;
        }

        return false;
      }

      await ensureSocketIO();
      const s = io('/', { auth: { token } });
      window.__notifSocket = s;

      s.on('connect_error', () => { /* молчим */ });

      s.on('message:new', async (m) => {
        const file = (location.pathname.split('/').pop() || '').toLowerCase();
        if (file === 'chat.html') {
          sessionStorage.setItem('chatBadgeCount','0');
          updateChatBadge(0);
          return;
        }

        // считаем ТОЛЬКО ответы на мои сообщения
        if (await isReplyToMeSmart(m)) {
          const curr = Number(sessionStorage.getItem('chatBadgeCount') || '0');
          const next = curr + 1;
          sessionStorage.setItem('chatBadgeCount', String(next));
          updateChatBadge(next);
        }
      });
    } catch (e) {
      // тихо
    }
  })();

  // ===== Мини-уведомления в шапке =====
  (function initHeaderDropdown(){
    const btn = document.getElementById('chatHeaderIcon');
    const panel = document.getElementById('chatNotifDropdown');
    const list = document.getElementById('chatNotifList');
    const empty = document.getElementById('chatNotifEmpty');
    if (!btn || !panel) return;

    let opened = false;

    async function fetchNotifs(){
      try {
        const token = localStorage.getItem('userToken');
        if (!token) return [];
        const res = await fetch('/api/chat/notifications?limit=10', {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) return [];
        return await res.json();
      } catch { return []; }
    }

    function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

    function render(items){
      list.innerHTML = '';
      empty.style.display = items.length ? 'none' : 'block';
      items.forEach(n => {
        const time = new Date(n.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        const el = document.createElement('button');
        el.type = 'button';
        el.style.cssText = 'width:100%;text-align:left;background:transparent;border:0;color:inherit;cursor:pointer;padding:10px 12px;border-bottom:1px solid #1b2640;';
        el.innerHTML = `
          <div style="display:flex;gap:8px;align-items:center;">
            <div style="flex:1 1 auto;min-width:0;">
              <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(n.chatTitle)} • ${escapeHtml(n.senderName)}</div>
              <div style="color:#9fb3c8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(n.text || '')}</div>
            </div>
            <div style="color:#9fb3c8;font-size:12px;">${time}</div>
          </div>
        `;
        el.addEventListener('click', () => {
          sessionStorage.setItem('chatBadgeCount','0');
          updateChatBadge(0);
          closePanel();
          window.location.href = `chat.html?jump=${encodeURIComponent(n.id)}`;
        });
        list.appendChild(el);
      });
    }

    async function openPanel(){
      if (opened) return;
      opened = true;
      btn.setAttribute('aria-expanded','true');
      panel.style.display = 'block';

      const items = await fetchNotifs();
      render(items);

      try {
        const token = localStorage.getItem('userToken');
        if (token) {
          await fetch('/api/chat/notifications/read', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
          });
        }
      } catch {}
      sessionStorage.setItem('chatBadgeCount','0');
      updateChatBadge(0);

      setTimeout(()=> {
        const onDoc = (e) => {
          if (panel.contains(e.target) || btn.contains(e.target)) return;
          closePanel();
          document.removeEventListener('pointerdown', onDoc, true);
        };
        document.addEventListener('pointerdown', onDoc, true);
      }, 0);
    }

    function closePanel(){
      if (!opened) return;
      opened = false;
      btn.setAttribute('aria-expanded','false');
      panel.style.display = 'none';
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      opened ? closePanel() : openPanel();
    });
  })();
}

if (document.readyState !== 'loading') {
  initMenu();
} else {
  document.addEventListener('DOMContentLoaded', initMenu);
}