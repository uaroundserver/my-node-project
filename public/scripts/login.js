// Берём базу API: сначала из <body data-api-base="...">, потом из window.API_BASE, иначе — тот же домен
const API_BASE =
  (document.body && document.body.dataset && document.body.dataset.apiBase) ||
  (typeof window !== 'undefined' && window.API_BASE) ||
  '';

async function login(event) {
  event.preventDefault();

  const form = event.currentTarget || document.getElementById('loginForm');
  const submitBtn = form.querySelector('button[type="submit"]');
  const errorBox = document.getElementById('error-message');

  const email = String(document.getElementById('email').value || '').trim().toLowerCase();
  const password = String(document.getElementById('password').value || '').trim();

  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  if (submitBtn) { submitBtn.disabled = true; }

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'omit',
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.error || 'Ошибка входа';
      if (errorBox) { errorBox.textContent = msg; errorBox.style.display = 'block'; }
      else { alert(msg); }
      return;
    }

    // Успех
    localStorage.setItem('userToken', data.token);
    localStorage.setItem('userData', JSON.stringify({ email }));

    // (опционально) подтянуть профиль, но не ломать поток, если 401/404
    try {
      const p = await fetch(`${API_BASE}/api/user/profile`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (p.ok) {
        const profile = await p.json();
        localStorage.setItem('userData', JSON.stringify(profile));
      }
    } catch {}

    window.location.href = 'home.html';
  } catch (err) {
    console.error('Ошибка входа:', err);
    const msg = 'Сервер недоступен, попробуйте позже';
    if (errorBox) { errorBox.textContent = msg; errorBox.style.display = 'block'; }
    else { alert(msg); }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; }
  }
}

// Навешиваем обработчик без инлайна (важно для CSP)
document.addEventListener('DOMContentLoaded', () => {
  // если уже есть токен — на главную
  if (localStorage.getItem('userToken')) {
    window.location.href = 'home.html';
    return;
  }
  const form = document.getElementById('loginForm');
  if (form) form.addEventListener('submit', login);
});
