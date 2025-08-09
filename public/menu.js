function sidebar() {
  return document.getElementById('sidebar');
}
function backdrop() {
  return document.getElementById('menu-backdrop');
}
function menuBtn() {
  return document.getElementById('menuButton');
}

// открыть/закрыть сайдбар
function toggleSidebar() {
  if (sidebar().classList.contains('active')) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function openSidebar() {
  sidebar().classList.add('active');
  if (backdrop()) {
    backdrop().hidden = false;
    setTimeout(() => backdrop().classList.add('active'), 10); // плавное затемнение
  }
  document.documentElement.classList.add('no-scroll');
  if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  sidebar().classList.remove('active');
  if (backdrop()) {
    backdrop().classList.remove('active');
    setTimeout(() => { backdrop().hidden = true; }, 300); // ждём анимацию
  }
  document.documentElement.classList.remove('no-scroll');
  if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'false');
}

// закрытие по Esc
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSidebar();
});

// клик по ссылке в сайдбаре
document.addEventListener('click', e => {
  if (e.target.closest('#sidebar a')) closeSidebar();
});

// клик по фону закрывает меню
document.addEventListener('click', e => {
  if (backdrop() && e.target === backdrop()) {
    closeSidebar();
  }
});

// Закрывать меню при скролле
window.addEventListener('scroll', () => {
  if (sidebar().classList.contains('active')) {
    closeSidebar();
  }
});

// авто-подсветка активных ссылок
(function setActiveLinks() {
  const path = location.pathname.split('/').pop() || 'home.html';
  const links = document.querySelectorAll('#bottom-nav a, #sidebar a');
  links.forEach(a => {
    try {
      const href = a.getAttribute('href') || '';
      const file = href.split('?')[0].split('#')[0];
      if (file && path === file) a.classList.add('active');
    } catch (_) {}
  });
})();