// Проверка авторизации при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('userToken');
    if (!token) {
        window.location.href = 'login.html';
    }
});

// Перейти на главную
function goHome() {
    window.location.href = 'home.html';
}

// Выход
function logout() {
    localStorage.removeItem('userToken');
    localStorage.removeItem('userData');
    window.location.href = 'login.html';
}
