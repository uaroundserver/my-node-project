async function register(event) {
    event.preventDefault();

    const email = document.getElementById('email').value.toLowerCase(); // приводим к нижнему регистру
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('https://uaround.onrender.com/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (response.ok) {
            alert(data.message || 'Регистрация успешна!');
            window.location.href = 'success.html';  // куда хочешь после регистрации
        } else {
            alert(data.error || 'Ошибка регистрации');
        }
    } catch (error) {
        alert('Ошибка сервера или сети');
        console.error(error);
    }
}
