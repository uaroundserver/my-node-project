// элементы
const sidebar  = () => document.getElementById('sidebar');
const backdrop = () => document.getElementById('menu-backdrop');
const menuBtn  = () => document.getElementById('menuButton');

// API
function openSidebar() {
  sidebar().classList.add('active');
  if (backdrop()) backdrop().hidden = false;
  document.documentElement.classList.add('no-scroll');
  if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'true');
}
function closeSidebar() {
  sidebar().classList.remove('active');
  if (backdrop()) backdrop().hidden = true;
  document.documentElement.classList.remove('no-scroll');
  if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'false');
}
function toggleSidebar() {
  sidebar().classList.contains('active') ? closeSidebar() : openSidebar();
}
window.toggleSidebar = toggleSidebar; // чтобы вызвать из onclick в HTML

// ESC закрывает
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

// Клик по бэкдропу закрывает
if (backdrop()) backdrop().addEventListener('click', closeSidebar);

// Клик по ссылке внутри сайдбара — закрыть
document.addEventListener('click', (e) => {
  if (e.target.closest('#sidebar a')) {
    closeSidebar();
  }
});

// Клик-вне: если меню открыто и клик НЕ внутри сайдбара и НЕ по кнопке — закрыть
document.addEventListener('click', (e) => {
  if (!sidebar().classList.contains('active')) return;
  if (e.target.closest('#sidebar')) return;
  if (e.target.closest('#menuButton')) return;
  closeSidebar();
});

// авто-подсветка активных ссылок (низ + сайдбар)
(function setActiveLinks() {
  const path = location.pathname.split('/').pop() || 'home.html';
  const links = document.querySelectorAll('#bottom-nav a, #sidebar a');
  links.forEach(a => {
    const href = (a.getAttribute('href') || '').split('?')[0].split('#')[0];
    if (href && path === href) a.classList.add('active');
  });
})();