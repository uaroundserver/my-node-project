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
        const err = new Error(msg); err.status = res.status; err.payload = payload; throw err;
      }
      return payload;
    } catch (e) {
      if (!(e instanceof Error)) e = new Error('Network error');
      if (e.status === 401) { localStorage.removeItem('userToken'); location.href = 'login.html'; }
      throw e;
    }
  }
  const API = (path, opts = {}) => apiFetch(`${location.origin.replace(/\/$/, '')}/api/chat` + path, opts);
  const API_ABS = (path, opts = {}) => apiFetch(path, opts);

  // ===== auth =====
  const token = localStorage.getItem('userToken');
  if (!token) { location.href = 'login.html'; return; }

  // ===== els =====
  const els = {
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

    replyBar: document.getElementById('replyBar'),
    replyText: document.getElementById('replyText'),
    replyCancel: document.getElementById('replyCancel'),

    composer: document.querySelector('.composer'),
  };

  const urlParams = new URLSearchParams(location.search);
  const chatIdFromUrl = urlParams.get('chatId');
  const jumpId = urlParams.get('jump');

  // ===== state =====
  let currentChat = chatIdFromUrl ? { _id: chatIdFromUrl } : null;
  let messages = [];
  let myId = null;
  let loadingHistory = false;
  let typingTimeout = null;
  let replyTo = null;
  let pendingAttachments = [];

  // ===== utils =====
  const escapeHtml = (s) => (s || '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const truncate = (s, n) => (s || '').length > n ? s.slice(0, n - 1) + '…' : s;
  const timeShort = (t) => { const d = new Date(t); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

  // ===== header =====
  function setHeader(chat) {
    const title = (chat?.title || '').trim() || 'Чат';
    if (els.tgTitle) els.tgTitle.textContent = title;
    if (els.tgSub) els.tgSub.textContent = '';
    const firstChar = (title[0] || 'Ч').toUpperCase();
    if (els.tgAvatarImg && els.tgAvatarLetter) {
      if (chat?.avatar) {
        els.tgAvatarImg.src = chat.avatar;
        els.tgAvatarImg.style.display = 'block';
        els.tgAvatarLetter.style.display = 'none';
      } else {
        els.tgAvatarImg.src = '';
        els.tgAvatarImg.style.display = 'none';
        els.tgAvatarLetter.textContent = firstChar;
        els.tgAvatarLetter.style.display = 'grid';
      }
    }
  }

  // ===== padding fix =====
  function updateComposerPadding() {
    if (!els.messages || !els.composer) return;
    const h = Math.ceil(els.composer.getBoundingClientRect().height || 0);
    els.messages.style.paddingBottom = (h + 8) + 'px';
  }
  if (window.ResizeObserver && els.composer) {
    new ResizeObserver(updateComposerPadding).observe(els.composer);
  }
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', updateComposerPadding);
    visualViewport.addEventListener('scroll', updateComposerPadding);
  }
  window.addEventListener('orientationchange', updateComposerPadding);

  // ===== scroll helpers =====
  const isNearBottom = () => {
    const el = els.messages; if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  const scrollToBottom = () => {
    if (!els.messages) return;
    els.messages.scrollTop = els.messages.scrollHeight - els.messages.clientHeight + 999;
  };

  // ===== profile =====
  apiFetch('/api/user/profile').then((u) => { myId = u._id || u.id; }).catch(()=>{});

  // ===== load chat meta (title/avatar) if нужно =====
  (async () => {
    if (!currentChat) return;
    try {
      const meta = await API(`/chat/${encodeURIComponent(currentChat._id)}`);
      currentChat = { ...currentChat, ...meta };
      setHeader(currentChat);
    } catch {
      setHeader(currentChat);
    }
  })();

  // ===== history =====
  async function loadHistory(before) {
    if (!currentChat || loadingHistory) return;
    loadingHistory = true;
    try {
      const q = new URLSearchParams({ chatId: currentChat._id, limit: 30 });
      if (before) q.set('before', before);
      const history = await API('/messages?' + q.toString());
      messages = before ? history.concat(messages) : history;
      renderMessages();
      updateComposerPadding();
    } finally {
      loadingHistory = false;
    }
  }
  els.messages && els.messages.addEventListener('scroll', () => {
    const el = els.messages;
    if (el.scrollTop === 0 && messages.length) loadHistory(messages[0].createdAt);
  });

  // ===== render =====
  function renderMessages() {
    if (!els.messages) return;
    const prevKeep = isNearBottom();
    els.messages.innerHTML = '';
    messages.forEach((m) => {
      const div = document.createElement('div');
      const isMine = String(m.senderId || m.userId) === String(myId);
      div.className = 'msg ' + (isMine ? 'mine' : 'their') + (m._justAdded ? ' msg--new' : '');
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
        const ava = src.senderAvatar ? `<img src="${src.senderAvatar}" class="reply-ava" />` : '';
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
        }).join('');

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
        </div>`;

      // контекстное меню
      div.oncontextmenu = (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, m); };
      // короткий тап
      attachTapGuard(div, (x, y) => showContextMenu(x, y, m));
      // свайп-вправо
      attachSwipeToReply(div, () => setReply(m));
      // переход по цитате
      const rEl = div.querySelector('.reply');
      if (rEl && rEl.dataset.replyId) {
        const go = (e)=>{ e.stopPropagation(); if(e.cancelable) e.preventDefault(); jumpToMessage(rEl.dataset.replyId); };
        rEl.addEventListener('click', go);
        rEl.addEventListener('touchend', go, { passive: false });
      }

      els.messages.appendChild(div);
      if (m._justAdded) m._justAdded = false;
    });
    if (prevKeep) scrollToBottom();
    updateComposerPadding();
  }

  // ===== tap guard =====
  function attachTapGuard(el, onTap) {
    const MOVE_GUARD = 8, MAX_TAP_MS = 400;
    let startX=0, startY=0, startT=0, startScroll=0, moved=false, multi=false;
    function xy(ev){
      if (ev.changedTouches && ev.changedTouches[0]) return {x:ev.changedTouches[0].clientX,y:ev.changedTouches[0].clientY};
      if (ev.touches && ev.touches[0]) return {x:ev.touches[0].clientX,y:ev.touches[0].clientY};
      return {x:ev.clientX,y:ev.clientY};
    }
    function start(ev){ if (ev.target.closest('a,button,input,textarea,.reply')) return;
      const p = xy(ev); startX=p.x; startY=p.y; startT=Date.now(); startScroll = els.messages?els.messages.scrollTop:0;
      moved=false; multi=!!(ev.touches && ev.touches.length>1);
    }
    function move(ev){ if (multi) { moved=true; return; }
      const p = xy(ev); const dx=Math.abs(p.x-startX), dy=Math.abs(p.y-startY);
      const sc = els.messages ? Math.abs(els.messages.scrollTop-startScroll):0;
      if (dx>MOVE_GUARD || dy>MOVE_GUARD || sc>2) moved=true;
    }
    function end(ev){ if (multi) return; if (ev.target && ev.target.closest('.reply')) return;
      move(ev); const dur = Date.now()-startT; if (moved || dur>MAX_TAP_MS) return;
      let {x,y} = xy(ev); if (!x && !y){ const r = el.getBoundingClientRect(); x=r.left+r.width/2; y=r.top+r.height/2; }
      onTap(x,y,ev);
    }
    el.addEventListener('touchstart', start, {passive:true});
    el.addEventListener('touchmove',  move,  {passive:true});
    el.addEventListener('touchend',   end);
    el.addEventListener('touchcancel',()=>{ moved=true; });
    el.addEventListener('mousedown', (e)=>{
      start(e);
      const up = (ev)=>{ end(ev); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  // ===== swipe-to-reply =====
  function attachSwipeToReply(el, onTrigger) {
    let startX=0,startY=0,dx=0,dy=0,active=false,ready=false,vibr=false;
    const TH=38,CV=28,MAX=64;
    function onStart(e){ const t=e.touches?e.touches[0]:e; startX=t.clientX; startY=t.clientY; dx=0; dy=0; active=true; ready=false; vibr=false; el.classList.add('is-swiping'); }
    function onMove(e){ if(!active) return; const t=e.touches?e.touches[0]:e; dx=t.clientX-startX; dy=Math.abs(t.clientY-startY);
      if(dy>CV){ onEnd(); return; } if(dx>0){ const pull=Math.min(dx,MAX); el.style.transform=`translateX(${pull}px)`;
        if(pull>TH && !ready){ el.classList.add('swipe-ready'); ready=true; if(!vibr && 'vibrate' in navigator){ navigator.vibrate(8); vibr=true; } }
        if(pull<=TH && ready){ el.classList.remove('swipe-ready'); ready=false; } } }
    function onEnd(){ if(!active) return; active=false; el.style.transform=''; el.classList.remove('is-swiping'); if(ready){ el.dataset.swipedAt=String(Date.now()); el.classList.remove('swipe-ready'); onTrigger&&onTrigger(); } }
    el.addEventListener('touchstart', onStart, {passive:true});
    el.addEventListener('touchmove', onMove, {passive:true});
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    let md=false; el.addEventListener('mousedown',(e)=>{ md=true; onStart(e); });
    window.addEventListener('mousemove',(e)=>{ if(md) onMove(e); });
    window.addEventListener('mouseup',()=>{ if(md){ md=false; onEnd(); } });
  }

  // ===== context menu + reactions =====
  let ctx=null,onWinClick=null,onWinTouch=null;
  function showContextMenu(x,y,m){
    hideContextMenu();
    ctx=document.createElement('div'); ctx.id='msgContextMenu';
    Object.assign(ctx.style,{position:'fixed',left:Math.min(x,window.innerWidth-200)+'px',top:Math.min(y,window.innerHeight-180)+'px',
      background:'#0e1522',border:'1px solid #223147',borderRadius:'10px',padding:'6px',zIndex:10000,minWidth:'160px',
      boxShadow:'0 8px 24px rgba(0,0,0,.35)'});
    ctx.addEventListener('click',e=>e.stopPropagation());
    ctx.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
    const my = String(m.senderId||m.userId)===String(myId);
    const mk=(label,fn)=>{ const b=document.createElement('button'); b.textContent=label; Object.assign(b.style,{
        display:'block',width:'100%',background:'transparent',border:'0',color:'white',padding:'10px 12px',textAlign:'left',fontSize:'16px',cursor:'pointer'
      }); b.onmousedown=(ev)=>ev.preventDefault(); b.onclick=(ev)=>{ fn(ev); hideContextMenu(); }; ctx.appendChild(b); };
    mk('Ответить',()=>setReply(m));
    mk('👍 Реакция',(ev)=>{ const r=ctx.getBoundingClientRect(); const ex=(ev&&ev.clientX)||(r.left+20); const ey=(ev&&ev.clientY)||(r.top+20); react(m,'👍',ex,ey); });
    if(my){
      mk('Редактировать',()=>{ const nt=prompt('Изменить сообщение', m.text||''); if(nt!=null) socket.emit('message:edit',{id:m._id,text:nt},ackHandler); });
      mk('Удалить',()=>{ if(confirm('Удалить?')) socket.emit('message:delete',{id:m._id},ackHandler); });
    }
    document.body.appendChild(ctx);
    onWinClick=(ev)=>{ if(!ctx.contains(ev.target)) hideContextMenu(); };
    onWinTouch=(ev)=>{ if(!ctx.contains(ev.target)) hideContextMenu(); };
    window.addEventListener('click', onWinClick);
    window.addEventListener('touchstart', onWinTouch, {passive:true});
  }
  function hideContextMenu(){ if(ctx){ ctx.remove(); ctx=null; } if(onWinClick){ window.removeEventListener('click',onWinClick); onWinClick=null; } if(onWinTouch){ window.removeEventListener('touchstart',onWinTouch); onWinTouch=null; } }
  function emojiBurst(x,y,emoji='👍'){ const b=document.createElement('div'); b.className='emoji-burst'; b.textContent=emoji; b.style.left=x+'px'; b.style.top=y+'px'; document.body.appendChild(b); b.addEventListener('animationend',()=>b.remove()); }
  function react(m,emoji='👍',x,y){ socket.emit('message:react',{id:m._id,emoji},(ack)=>{ if(ack?.ok && typeof x==='number' && typeof y==='number') emojiBurst(x,y,emoji); if(!ack?.ok) ackHandler(ack); }); }

  // ===== jump to message =====
  async function jumpToMessage(id) {
    if (!currentChat) { window.location.href = `chat.html?jump=${encodeURIComponent(id)}`; return; }
    try {
      const meta = await API_ABS(`/api/chat/message/${encodeURIComponent(id)}`);
      const targetTime = new Date(meta.createdAt).getTime();
      let guard = 0;
      while (guard < 40) {
        const el = els.messages && els.messages.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (el) { el.classList.add('highlight'); el.scrollIntoView({ behavior:'smooth', block:'center' }); setTimeout(()=>el.classList.remove('highlight'),1600); return; }
        if (!messages.length) break;
        const firstTime = new Date(messages[0].createdAt).getTime();
        if (firstTime <= targetTime) break;
        await loadHistory(messages[0].createdAt);
        guard++;
      }
      const el2 = els.messages && els.messages.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (el2) { el2.classList.add('highlight'); el2.scrollIntoView({ behavior:'smooth', block:'center' }); setTimeout(()=>el2.classList.remove('highlight'),1600); return; }
      window.location.href = `chat.html?jump=${encodeURIComponent(id)}`;
    } catch {
      window.location.href = `chat.html?jump=${encodeURIComponent(id)}`;
    }
  }

  // ===== reply bar =====
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
      if (!els.replyBar.classList.contains('visible')) els.replyBar.setAttribute('hidden', 'hidden');
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

  // кнопка «Отправить» не забирает фокус
  if (els.sendBtn) {
    els.sendBtn.setAttribute('tabindex', '-1');
    els.sendBtn.addEventListener('mousedown', (e) => e.preventDefault());
    els.sendBtn.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });
  }
  // Закрываем клавиатуру только при тапе вне композера
  function maybeBlurOnOutsideTap(ev) {
    if (!els.msgInput) return;
    if (ev.target.closest('.composer')) return;
    if (document.activeElement === els.msgInput) els.msgInput.blur();
  }
  document.addEventListener('click', maybeBlurOnOutsideTap);
  document.addEventListener('touchend', maybeBlurOnOutsideTap, { passive: true });

  // отправка
  els.sendBtn && (els.sendBtn.onclick = send);
  els.msgInput && els.msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  function send() {
    if (!currentChat) return;
    const text = (els.msgInput.value || '').trim();
    if (!text && pendingAttachments.length === 0) return;
    const payload = { chatId: currentChat._id, text, attachments: pendingAttachments };
    if (replyTo) payload.replyTo = replyTo._id;
    socket.emit('message:send', payload, (ack) => {
      if (ack?.ok) {
        els.msgInput.value = '';
        els.msgInput.style.height = 'auto';
        pendingAttachments = [];
        clearReply();
        updateComposerPadding();
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

  // прочитано
  function maybeMarkRead(newMsgs) {
    const ids = (newMsgs || messages)
      .filter((m) => String(m.senderId || m.userId) !== String(myId))
      .map((m) => m._id);
    if (ids.length) socket.emit('message:read', { ids }, () => {});
  }

  // ===== init =====
  (async () => {
    if (!currentChat) {
      // если зашли без chatId — на список чатов
      location.href = 'chats.html';
      return;
    }
    await loadHistory();
    updateComposerPadding();
    if (jumpId) {
      // подгрузка вокруг нужного сообщения
      try {
        const meta = await API_ABS(`/api/chat/message/${encodeURIComponent(jumpId)}`);
        if (meta?.createdAt) {
          const pivot = new Date(new Date(meta.createdAt).getTime() + 1).toISOString();
          const q = new URLSearchParams({ chatId: currentChat._id, limit: 200, before: pivot });
          const pack = await API('/messages?' + q.toString());
          messages = pack; renderMessages();
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
  })();
})();