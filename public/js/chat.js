(function () {
  // ===== helpers
  function buildHeaders(opts = {}) {
    const h = { ...(opts.headers || {}) };
    const token = localStorage.getItem('userToken');
    if (token) h.Authorization = 'Bearer ' + token;
    if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json';
    return h;
  }
  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: buildHeaders(opts) });
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json().catch(()=>null) : await res.text().catch(()=> '');
    if (!res.ok) throw new Error((payload && payload.error) || res.statusText || 'Request failed');
    return payload;
  }
  const API = (p,o={}) => apiFetch(`${location.origin.replace(/\/$/,'')}/api/chat${p}`, o);
  const API_ABS = (p,o={}) => apiFetch(p,o);

  // ===== auth
  if (!localStorage.getItem('userToken')) { location.href='login.html'; return; }

  // ===== DOM
  const els = {
    messages: document.getElementById('messageList'),
    msgInput: document.getElementById('msgInput'),
    sendBtn: document.getElementById('sendBtn'),
    fileInput: document.getElementById('fileInput'),
    attachBtn: document.getElementById('attachBtn'),
    replyBar: document.getElementById('replyBar'),
    replyText: document.getElementById('replyText'),
    replyCancel: document.getElementById('replyCancel'),
    tgTitle: document.getElementById('tgTitle'),
    tgSub: document.getElementById('tgSub'),
    tgAvatarImg: document.getElementById('tgAvatarImg'),
    tgAvatarLetter: document.getElementById('tgAvatarLetter'),
    goBack: document.getElementById('goBack'),
    composer: document.querySelector('.composer'),
  };

  const chatId = new URLSearchParams(location.search).get('id');
  if (!chatId) { location.href='chats.html'; return; }

  // ===== state
  let myId=null, messages=[], loadingHistory=false, typingTimeout=null, replyTo=null, pendingAttachments=[];
  let atBottom=true;

  function escapeHtml(s){return (s||'').replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));}
  function timeShort(t){const d=new Date(t);return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}

  // header
  function setHeader(title, avatar){
    const t = (title||'Чат').trim();
    if (els.tgTitle) els.tgTitle.textContent=t;
    if (els.tgSub) els.tgSub.textContent='';
    if (els.tgAvatarImg && els.tgAvatarLetter){
      if (avatar){
        els.tgAvatarImg.src=avatar; els.tgAvatarImg.style.display='block'; els.tgAvatarLetter.style.display='none';
      } else {
        els.tgAvatarImg.src=''; els.tgAvatarImg.style.display='none';
        els.tgAvatarLetter.style.display='grid'; els.tgAvatarLetter.textContent=(t[0]||'A').toUpperCase();
      }
    }
  }

  // back
  els.goBack && els.goBack.addEventListener('click', ()=> history.length>1 ? history.back() : location.href='chats.html');

  // composer padding
  function updateComposerPadding(){
    if(!els.messages || !els.composer) return;
    const h = Math.ceil(els.composer.getBoundingClientRect().height||0);
    els.messages.style.paddingBottom = (h + 8) + 'px';
  }
  if (window.ResizeObserver && els.composer){
    new ResizeObserver(updateComposerPadding).observe(els.composer);
  }
  if (window.visualViewport){
    visualViewport.addEventListener('resize', updateComposerPadding);
    visualViewport.addEventListener('scroll', updateComposerPadding);
  }
  window.addEventListener('orientationchange', updateComposerPadding);

  function isNearBottom(){
    const el=els.messages;if(!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }
  function scrollToBottom(){
    if(!els.messages) return;
    els.messages.scrollTop = els.messages.scrollHeight - els.messages.clientHeight + 999;
  }

  // profile for myId
  apiFetch('/api/user/profile').then(u=>{ myId=u._id||u.id; }).catch(()=>{});

  // load chat meta (если есть эндпоинт)
  (async ()=>{
    try{
      const meta = await API(`/chat-info?chatId=${encodeURIComponent(chatId)}`).catch(()=>null);
      setHeader(meta?.title||'Чат', meta?.avatar||'');
    }catch{ setHeader('Чат',''); }
  })();

  // history
  async function loadHistory(before){
    if(loadingHistory) return;
    loadingHistory = true;
    try{
      const q = new URLSearchParams({ chatId, limit: 30 });
      if (before) q.set('before', before);
      const pack = await API('/messages?'+q.toString());
      messages = before ? pack.concat(messages) : pack;
      renderMessages();
      updateComposerPadding();
    }finally{ loadingHistory=false; }
  }

  // render
  function renderMessages(){
    if(!els.messages) return;
    const keep = isNearBottom();
    els.messages.innerHTML='';
    messages.forEach(m=>{
      const isMine = String(m.senderId||m.userId)===String(myId);
      const div = document.createElement('div');
      div.className = 'msg ' + (isMine?'mine':'their');
      div.dataset.id = m._id;

      // reply preview
      let replyHtml='';
      const src = m.reply || messages.find(x=>String(x._id)===String(m.replyTo));
      if (src){
        const who = String(src.senderId||src.userId)===String(myId)?'Вы':(src.senderName||'user');
        replyHtml = `<div class="reply" data-reply-id="${src._id}"><b>${escapeHtml(who)}</b>: ${escapeHtml(src.text||'(вложение)')}</div>`;
      }

      const reactionsHtml = (m.reactions||[]).map(r=>r.emoji).join(' ');

      div.innerHTML = `
        <div class="mrow"><div class="mname">${escapeHtml(m.senderName||'user')}</div></div>
        ${replyHtml}
        <div class="mtext">${escapeHtml(m.text||'')}</div>
        <div class="mmeta">
          <span>${timeShort(m.createdAt)}</span>
          ${isMine?`<span class="ticks" title="Доставлено/Прочитано">✓✓</span>`:''}
          ${reactionsHtml?`<span>${reactionsHtml}</span>`:''}
        </div>
      `;
      // click on reply -> jump
      const rEl = div.querySelector('.reply');
      if (rEl) rEl.addEventListener('click', ()=> jumpToMessage(rEl.dataset.replyId));

      // context menu (tap)
      div.addEventListener('click', (e)=>{
        // простой вариант: tap по сообщению = ответ
        if (!e.target.closest('.reply')) setReply(m);
      });

      els.messages.appendChild(div);
    });
    if (keep) scrollToBottom();
  }

  async function jumpToMessage(id){
    try{
      const meta = await API_ABS(`/api/chat/message/${encodeURIComponent(id)}`);
      const targetTime = new Date(meta.createdAt).getTime();
      let guard=0;
      while(guard<40){
        const el = els.messages.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (el){
          el.classList.add('highlight');
          el.scrollIntoView({behavior:'smooth',block:'center'});
          setTimeout(()=>el.classList.remove('highlight'),1600);
          return;
        }
        if(!messages.length) break;
        const firstTime = new Date(messages[0].createdAt).getTime();
        if(firstTime <= targetTime) break;
        await loadHistory(messages[0].createdAt);
        guard++;
      }
      // если не нашли — открываем страницу заново с якорем
      location.href = `chat.html?id=${encodeURIComponent(chatId)}&jump=${encodeURIComponent(id)}`;
    }catch{
      location.href = `chat.html?id=${encodeURIComponent(chatId)}&jump=${encodeURIComponent(id)}`;
    }
  }

  // reply helpers
  function setReply(m){
    replyTo = m;
    els.replyText.textContent = (m.text||'(вложение)').slice(0,140);
    els.replyBar.classList.add('visible');
    els.msgInput.focus();
    setTimeout(updateComposerPadding,0);
  }
  function clearReply(){
    replyTo=null;
    els.replyBar.classList.remove('visible');
    setTimeout(updateComposerPadding,220);
  }
  els.replyCancel.addEventListener('click', (e)=>{ e.preventDefault(); clearReply(); });

  // attachments
  els.attachBtn.addEventListener('click', ()=> els.fileInput.click());
  els.fileInput.addEventListener('change', async ()=>{
    const fd = new FormData();
    [...els.fileInput.files].forEach(f=>fd.append('files',f));
    const res = await apiFetch('/api/chat/attachments',{method:'POST',body:fd});
    pendingAttachments = res.files || [];
  });

  // sockets
  const socket = io('/', { auth:{ token: localStorage.getItem('userToken') } });

  socket.on('message:new', (m)=>{
    if (String(m.chatId)!==String(chatId)) return;
    messages.push(m);
    renderMessages();
    if (isNearBottom()) scrollToBottom();
    maybeMarkRead([m]);
  });
  socket.on('message:edited', ({id,text,editedAt})=>{
    const m = messages.find(x=>String(x._id)===String(id));
    if (m){ m.text=text; m.editedAt=editedAt; renderMessages(); }
  });
  socket.on('message:deleted', ({id})=>{
    const i = messages.findIndex(x=>String(x._id)===String(id));
    if (i>-1){ messages.splice(i,1); renderMessages(); }
  });
  socket.on('message:reactions', ({id,reactions})=>{
    const m = messages.find(x=>String(x._id)===String(id));
    if (m){ m.reactions=reactions; renderMessages(); }
  });
  socket.on('typing', ({isTyping})=>{
    els.tgSub.textContent = isTyping ? 'печатает…' : '';
  });

  // composer
  els.msgInput.addEventListener('input', function(){
    this.style.height='auto';
    this.style.height = Math.min(this.scrollHeight,160)+'px';
    updateComposerPadding();
    socket.emit('typing', { isTyping:true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(()=>socket.emit('typing',{isTyping:false}),1500);
  });

  // держим клавиатуру открытой
  // кнопка не забирает фокус
  els.sendBtn.setAttribute('tabindex','-1');
  els.sendBtn.addEventListener('mousedown', e=>e.preventDefault());
  els.sendBtn.addEventListener('touchstart', e=>{ e.preventDefault(); }, { passive:false });
  // закрывать клавиатуру только по тапу вне композера
  function maybeBlur(ev){
    if (ev.target.closest('.composer')) return;
    if (document.activeElement===els.msgInput) els.msgInput.blur();
  }
  document.addEventListener('click', maybeBlur);
  document.addEventListener('touchend', maybeBlur, { passive:true });

  els.sendBtn.addEventListener('click', send);
  els.msgInput.addEventListener('keydown', (e)=>{
    if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }
  });

  function send(){
    const text = (els.msgInput.value||'').trim();
    if (!text && pendingAttachments.length===0) return;
    const payload = { chatId, text, attachments: pendingAttachments };
    if (replyTo) payload.replyTo = replyTo._id;
    socket.emit('message:send', payload, (ack)=>{
      if (!ack?.ok) { alert(ack?.error||'Не отправлено'); return; }
      els.msgInput.value='';
      els.msgInput.style.height='auto';
      pendingAttachments=[];
      clearReply();
      updateComposerPadding();
      // вернуть фокус, чтобы клавиатура не закрывалась
      requestAnimationFrame(()=>{
        els.msgInput.focus();
        try{ els.msgInput.setSelectionRange(els.msgInput.value.length, els.msgInput.value.length);}catch{}
      });
      setTimeout(scrollToBottom,0);
    });
  }

  function maybeMarkRead(list){
    const ids = (list||messages).map(m=>m._id);
    if (ids.length) socket.emit('message:read', { ids }, ()=>{});
  }

  // init
  (async ()=>{
    await loadHistory();
    updateComposerPadding();
    // поддержим ?jump=... если пришли по пушу
    const jumpId = new URLSearchParams(location.search).get('jump');
    if (jumpId) jumpToMessage(jumpId);
  })();
})();