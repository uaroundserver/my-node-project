function register(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const userData = { username, password, profileCompleted: false };
    localStorage.setItem('userData', JSON.stringify(userData));

    // Переход на страницу успешной регистрации
    window.location.href = 'success.html';
}