const API_BASE = window.API_BASE || '';

async function login(event) {
  event.preventDefault();

  const email = document.getElementById('email').value.toLowerCase();
  const password = document.getElementById('password').value;

  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('userToken', data.token);
      localStorage.setItem('userData', JSON.stringify({ email }));
      window.location.href = 'home.html';
    } else {
      alert(data.error || 'Ошибка входа');
    }
  } catch (error) {
    alert('Ошибка сервера или сети');
    console.error(error);
  }
}