// Проверка авторизации
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('userToken');

  if (!token) {
    // Если нет токена, перенаправляем на страницу входа
    window.location.href = 'login.html';
  }
});

// Выход пользователя
function logout() {
  localStorage.removeItem('userToken'); // Удаление токена
  window.location.href = 'login.html'; // Переход на страницу входа
}