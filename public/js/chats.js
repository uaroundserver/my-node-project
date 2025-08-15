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
    if (!res.ok) throw new Error((await res.text()) || 'Request failed');
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }
  const API = (p, o={}) => apiFetch(`${location.origin.replace(/\/$/,'')}/api/chat${p}`, o);

  // ===== auth
  if (!localStorage.getItem('userToken')) { location.href = 'login.html'; return; }

  // ===== els
  const listEl = document.getElementById('chatList');
  const searchEl = document.getElementById('chatSearch');

  let allChats = [];

  function timeShort(t){
    if(!t) return '';
    const d = new Date(t);
    return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  }
  function escapeHtml(s){return (s||'').replace(/[&<>"]/g,c=>({ '&':'&','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));}

  function render(chats){
    listEl.innerHTML = '';
    if(!chats.length){
      const div = document.createElement('div');
      div.className='empty';
      div.textContent='Ничего не найдено';
      listEl.appendChild(div);
      return;
    }
    chats.forEach(c=>{
      const li = document.createElement('li');
      li.className='chat-item';
      const title = (c.title||'Чат').trim();
      const letter = (title[0]||'A').toUpperCase();
      const last = c.lastMessage;
      li.innerHTML = `
        <div class="avatar">
          ${c.avatar ? `<img src="${c.avatar}" onerror="this.remove();this.nextElementSibling.style.display='grid'">` : ''}
          <span class="letter" ${c.avatar?'style="display:none"':''}>${letter}</span>
        </div>
        <div class="cmeta">
          <div class="crow">
            <div class="title">${escapeHtml(title)}</div>
            <div class="time">${last?timeShort(last.createdAt):''}</div>
          </div>
          <div class="cpreview">
            <div class="text">
              ${last ? escapeHtml(`${last.senderName||'user'}: ${last.text||''}`) : 'Нет сообщений'}
            </div>
            ${c.unread?`<span class="badge">${c.unread}</span>`:''}
          </div>
        </div>
      `;
      li.addEventListener('click',()=>location.href=`chat.html?id=${encodeURIComponent(c._id||c.id)}`);
      listEl.appendChild(li);
    });
  }

  async function loadChats(){
    try{
      allChats = await API('/chats');
      render(allChats);
    }catch(e){
      listEl.innerHTML = `<div class="empty">Не удалось загрузить список чатов</div>`;
    }
  }

  // глобальный поиск
  let t;
  searchEl.addEventListener('input', ()=>{
    clearTimeout(t);
    const q = searchEl.value.trim();
    t = setTimeout(async ()=>{
      if(!q){ render(allChats); return; }

      // 1) пробуем серверный глобальный поиск (если он есть)
      try{
        const res = await API(`/search-all?q=${encodeURIComponent(q)}`);
        // ожидаем массив чатов или сообщений с chatId; приведём к списку чатов
        let chats=[];
        if(Array.isArray(res)){
          if(res.length && res[0] && (res[0].chatId || res[0].chat_id)){
            const ids = [...new Set(res.map(x=>String(x.chatId||x.chat_id)))];
            chats = allChats.filter(c=>ids.includes(String(c._id||c.id)));
          } else {
            chats = res;
          }
        }
        if(chats.length){ render(chats); return; }
      }catch(_){/* нет эндпоинта — ок, упадем на клиентский фильтр */ }

      // 2) клиентский фильтр по имени чата и превью последнего сообщения
      const ql = q.toLowerCase();
      const filtered = allChats.filter(c=>{
        const t = (c.title||'').toLowerCase().includes(ql);
        const lp = (c.lastMessage && ((c.lastMessage.text||'') + ' ' + (c.lastMessage.senderName||''))).toLowerCase().includes(ql);
        return t || lp;
      });
      render(filtered);
    }, 250);
  });

  // обновление бейджей по сокету (не обязательно)
  const socket = io('/', { auth:{ token: localStorage.getItem('userToken') } });
  socket.on('message:new', (m)=>{
    // перетаскиваем чат наверх и увеличиваем unread, если список уже загружен
    const idx = allChats.findIndex(c=>String(c._id||c.id)===String(m.chatId));
    if(idx>-1){
      const c = allChats[idx];
      c.lastMessage = { text:m.text, senderName:m.senderName, createdAt:m.createdAt };
      c.unread = (c.unread||0)+1;
      allChats.splice(idx,1);
      allChats.unshift(c);
      render(allChats);
    }
  });

  loadChats();
})();