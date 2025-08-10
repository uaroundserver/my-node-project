const API_BASE = 'https://uaround.onrender.com';

// Проверка авторизации при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('userToken');
  if (!token) return logout(); // нет токена → сразу на логин

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

    // навешиваем обработчики выхода на все кнопки с onclick="logout()" в menu.html
    document.querySelectorAll('[onclick="logout()"]').forEach(btn => {
      btn.addEventListener('click', logout);
    });

  } catch (err) {
    console.error('Ошибка авторизации:', err);
    logout();
  }
});

window.goHome = function () {
  window.location.href = 'home.html';
};

window.logout = function () {
  localStorage.removeItem('userToken');
  localStorage.removeItem('userData');
  window.location.href = 'login.html';
};