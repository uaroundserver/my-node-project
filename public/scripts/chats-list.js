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
    const res = await fetch(url, { ...opts, headers: buildHeaders(opts) });
    const ct = res.headers.get('content-type') || '';
    const isJSON = ct.includes('application/json');
    const payload = isJSON ? await res.json().catch(()=>null) : await res.text().catch(()=> '');
    if (!res.ok) throw new Error((payload && payload.error) || res.statusText || 'Request failed');
    return payload;
  }
  const API = (path, opts={}) => apiFetch(`${location.origin.replace(/\/$/,'')}/api/chat` + path, opts);

  // ===== auth guard =====
  const token = localStorage.getItem('userToken');
  if (!token) { location.href = 'login.html'; return; }

  // ===== els =====
  const listEl = document.getElementById('chatList');
  const searchEl = document.getElementById('chatSearch');

  // ===== state =====
  let allChats = [];

  // ===== render =====
  function avatarHTML(c){
    const letter = (c.title || 'Ч')[0].toUpperCase();
    const img = (c.avatar || '').trim();
    return `
      <div class="avatar">
        <img src="${img}" ${img ? '' : 'style="display:none"'} onerror="this.style.display='none'"/>
        <span class="letter" ${img ? 'style="display:none"' : ''}>${letter}</span>
      </div>`;
  }

  function render(chats){
    listEl.innerHTML = '';
    if (!chats.length){
      const li = document.createElement('li');
      li.style.color = '#90a4b4';
      li.style.padding = '18px';
      li.textContent = 'Чатов не найдено';
      listEl.appendChild(li);
      return;
    }
    chats.forEach(c=>{
      const li = document.createElement('li');
      li.className = 'chat-item';
      li.innerHTML = `
        ${avatarHTML(c)}
        <div class="cmeta">
          <div class="title">${(c.title || 'Чат')}</div>
          <div class="cpreview">
            ${c.lastMessage ? `${(c.lastMessage.senderName||'user')}: ${(c.lastMessage.text||'').slice(0,60)}` : 'Нет сообщений'}
            ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}
          </div>
        </div>
        <div class="time">${c.lastMessage ? timeShort(c.lastMessage.createdAt) : ''}</div>`;
      li.addEventListener('click', () => {
        location.href = `chat.html?chatId=${encodeURIComponent(c._id)}`;
      });
      listEl.appendChild(li);
    });
  }
  function timeShort(t){ const d = new Date(t); return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }

  // ===== data =====
  async function load(){
    try{
      const data = await API('/chats');
      allChats = Array.isArray(data) ? data : [];
      render(allChats);
    }catch(e){
      listEl.innerHTML = '<li style="color:#90a4b4;padding:18px">Не удалось загрузить список</li>';
    }
  }

  // ===== global search =====
  let timer;
  searchEl.addEventListener('input', ()=>{
    clearTimeout(timer);
    const q = searchEl.value.trim().toLowerCase();
    timer = setTimeout(async ()=>{
      if (!q){ render(allChats); return; }

      // Если на бэке есть эндпоинт глобального поиска — используем.
      try{
        const res = await API(`/search-global?q=${encodeURIComponent(q)}`);
        // ожидаем массив объектов чатов или сообщений; приведем к списку чатов
        const chatsMap = new Map();
        (Array.isArray(res) ? res : []).forEach(item=>{
          const c = item.chat || item;
          if (!c) return;
          const id = c._id || c.id;
          if (!id) return;
          if (!chatsMap.has(id)) chatsMap.set(id, { _id:id, title: c.title, avatar: c.avatar, lastMessage: c.lastMessage, unread: c.unread });
        });
        const found = [...chatsMap.values()];
        if (found.length) { render(found); return; }
      }catch(_){ /* игнор — упадем в локальный фильтр */ }

      // локальный фильтр по заголовку и предпросмотру
      const filtered = allChats.filter(c=>{
        const t = (c.title||'').toLowerCase();
        const p = ((c.lastMessage && c.lastMessage.text) || '').toLowerCase();
        const s = ((c.lastMessage && c.lastMessage.senderName) || '').toLowerCase();
        return t.includes(q) || p.includes(q) || s.includes(q);
      });
      render(filtered);
    }, 250);
  });

  // ===== init =====
  load();
})();