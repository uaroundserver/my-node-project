// открыть/закрыть сайдбар
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('active');
}

// закрытие по Esc и клику по ссылке
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('sidebar').classList.remove('active');
});
document.addEventListener('click', e => {
  const sb = document.getElementById('sidebar');
  if (e.target.closest('#sidebar a')) sb.classList.remove('active');
});

// авто-подсветка активных ссылок (низ + сайдбар)
(function setActiveLinks() {
  const path = location.pathname.split('/').pop() || 'home.html'; // по умолчанию home.html
  const links = document.querySelectorAll('#bottom-nav a, #sidebar a');
  links.forEach(a => {
    try {
      const href = a.getAttribute('href') || '';
      // сравниваем только имя файла без параметров
      const file = href.split('?')[0].split('#')[0];
      if (file && path === file) a.classList.add('active');
    } catch (_) {}
  });
})();