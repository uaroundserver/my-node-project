const API_BASE = window.API_BASE || '';

async function register(event) {
  event.preventDefault();

  const email = document.getElementById('email').value.toLowerCase();
  const password = document.getElementById('password').value;
  const country = document.getElementById('country').value;

  try {
    const response = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, country }),
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message || 'Регистрация успешна! Проверьте почту.');
      window.location.href = 'success.html';
    } else {
      alert(data.error || 'Ошибка регистрации');
    }
  } catch (error) {
    alert('Ошибка сервера или сети');
    console.error(error);
  }
}