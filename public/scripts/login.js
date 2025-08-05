async function login(event) {
  event.preventDefault();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const response = await fetch('https://uaround.onrender.com/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (response.ok) {
      // Успешный вход — сохраняем токен и переходим
      localStorage.setItem('userToken', 'fake-token'); // или data.token, если будет
      localStorage.setItem('userData', JSON.stringify({ email }));
     // alert(data.message || 'Вход выполнен');
      window.location.href = 'home.html';
    } else {
      alert(data.error || 'Ошибка входа');
    }
  } catch (error) {
    alert('Ошибка сервера или сети');
    console.error(error);
  }
}
