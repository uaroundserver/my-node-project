async function register(event) {
    event.preventDefault();

    const email = document.getElementById('email').value.toLowerCase();
    const password = document.getElementById('password').value;
    const country = document.getElementById('country').value;  // добавили страну

    try {
        const response = await fetch('https://uaround.onrender.com/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, country }),  // отправляем страну вместе с email и паролем
        });

        const data = await response.json();

        if (response.ok) {
            alert(data.message || 'Регистрация успешна!');
            window.location.href = 'success.html';
        } else {
            alert(data.error || 'Ошибка регистрации');
        }
    } catch (error) {
        alert('Ошибка сервера или сети');
        console.error(error);
    }
}