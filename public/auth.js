const API_BASE = window.API_BASE || '';

// --- Глобальная функция выхода ---
window.logout = function () {
  localStorage.removeItem('userToken');
  localStorage.removeItem('userData');
  window.location.href = 'login.html';
};

// --- Проверка авторизации при загрузке ---
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('userToken');
  if (!token) return logout();

  try {
    const res = await fetch(`${API_BASE}/api/user/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) return logout();
    if (!res.ok) throw new Error('Ошибка профиля');

    const user = await res.json();
    // Обновляем UI, если на странице есть элементы
    const elEmail = document.getElementById('email');
    if (elEmail && user.email) elEmail.textContent = user.email;
    const avatarEl = document.getElementById('avatar');
    if (avatarEl && user.avatar) avatarEl.src = user.avatar;
  } catch (e) {
    console.error(e);
    logout();
  }
});

// --- Делегирование события выхода (работает с любыми кнопками) ---
document.addEventListener('click', (e) => {
  const logoutBtn = e.target.closest('[onclick="logout()"], .js-logout, [data-logout]');
  if (logoutBtn) {
    e.preventDefault();
    logout();
  }
});

// --- Переход на главную ---
window.goHome = function () {
  window.location.href = 'home.html';
};