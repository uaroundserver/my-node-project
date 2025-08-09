const sidebar  = () => document.getElementById('sidebar');
const backdrop = () => document.getElementById('menu-backdrop');
const menuBtn  = () => document.getElementById('menuButton');

function openSidebar() {
  sidebar().classList.add('active');
  if (backdrop()) {
    backdrop().hidden = false;
    setTimeout(() => backdrop().classList.add('active'), 10);
  }
  document.documentElement.classList.add('no-scroll');
  if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  sidebar().classList.remove('active');
  if (backdrop()) {
    backdrop().classList.remove('active');
    setTimeout(() => { backdrop().hidden = true; }, 300);
  }
  document.documentElement.classList.remove('no-scroll');
  if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  sidebar().classList.contains('active') ? closeSidebar() : openSidebar();
}
window.toggleSidebar = toggleSidebar;

// Esc
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

// Клик по бэкдропу
if (backdrop()) {
  backdrop().addEventListener('click', closeSidebar);
}

// Клик по ссылке в сайдбаре
document.addEventListener('click', (e) => {
  if (e.target.closest('#sidebar a')) closeSidebar();
});

// Клик вне меню и кнопки
document.addEventListener('click', (e) => {
  if (!sidebar().classList.contains('active')) return;
  if (e.target.closest('#sidebar')) return;
  if (e.target.closest('#menuButton')) return;
  closeSidebar();
});

// Закрытие при скролле
window.addEventListener('scroll', () => {
  if (sidebar().classList.contains('active')) closeSidebar();
});

// Подсветка активных ссылок
(function setActiveLinks() {
  const path = location.pathname.split('/').pop() || 'home.html';
  const links = document.querySelectorAll('#bottom-nav a, #sidebar a');
  links.forEach(a => {
    const href = (a.getAttribute('href') || '').split('?')[0].split('#')[0];
    if (href && path === href) a.classList.add('active');
  });
})();