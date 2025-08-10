const API_BASE = 'https://uaround.onrender.com';

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
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401) return logout();
    if (!res.ok) throw new Error('Ошибка проверки токена');

    const userData = await res.json();
    localStorage.setItem('userData', JSON.stringify(userData));

    // показываем меню
    const menuButton = document.getElementById('menuButton');
    const sidebar = document.getElementById('sidebar');
    if (menuButton) menuButton.style.display = '';
    if (sidebar) sidebar.style.display = '';

  } catch (err) {
    console.error('Ошибка авторизации:', err);
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