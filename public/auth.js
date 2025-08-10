const API_BASE = 'https://uaround.onrender.com';

// Проверка авторизации при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('userToken');
  if (!token) return logout(); // нет токена → сразу на логин

  try {
    // быстрая проверка токена на сервере
    const res = await fetch(`${API_BASE}/api/user/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401) return logout(); // токен истёк/неверен → выходим
    if (!res.ok) throw new Error('Ошибка проверки токена');

    const userData = await res.json();
    localStorage.setItem('userData', JSON.stringify(userData)); // обновляем локальные данные

    // показываем меню, если оно уже подгружено (на всякий случай)
    const menuButton = document.getElementById('menuButton');
    const sidebar = document.getElementById('sidebar');
    if (menuButton) menuButton.style.display = '';
    if (sidebar) sidebar.style.display = '';
  } catch (err) {
    console.error('Ошибка авторизации:', err);
    logout();
  }
});

// Перейти на главную
window.goHome = function () {
  window.location.href = 'home.html';
};

// Выход
window.logout = function () {
  localStorage.removeItem('userToken');
  localStorage.removeItem('userData');
  window.location.href = 'login.html';
};

// ВАЖНО: никаких функций управления сайдбаром здесь!
// toggleSidebar и всё, что открывает/закрывает меню, должно быть только в menu.js