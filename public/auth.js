// Проверка авторизации при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('userToken');
    if (!token) {
        window.location.href = 'login.html';
    }
});

// Перейти на главную
window.goHome = function() {
    window.location.href = 'home.html';
};

// Выход
window.logout = function() {
    localStorage.removeItem('userToken');
    localStorage.removeItem('userData');
    window.location.href = 'login.html';
};

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
  }

  function logout() {
    localStorage.removeItem('userToken');
    localStorage.removeItem('userData');
    window.location.href = 'login.html';
  }

// Показываем меню только если пользователь авторизован
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('userToken');
  const menuButton = document.getElementById('menuButton');
  const sidebar = document.getElementById('sidebar');

  if (!token) {
    // Если не авторизован — убираем меню
    if (menuButton) menuButton.style.display = 'none';
    if (sidebar) sidebar.style.display = 'none';
  }
});