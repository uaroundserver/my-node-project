function login(event) {
  event.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  const storedUser = JSON.parse(localStorage.getItem('userData'));

  if (storedUser && storedUser.username === username && storedUser.password === password) {
    localStorage.setItem('userToken', 'fake-token');
    window.location.href = 'home.html';
  } else {
    alert('Неверный логин или пароль');
  }
}