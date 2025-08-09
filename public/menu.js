function sidebar() { return document.getElementById('sidebar'); }
function backdrop() { return document.getElementById('menu-backdrop'); }
function menuBtn()  { return document.getElementById('menuButton'); }

let scrollLockY = 0;
let isOpen = false;

function lockScroll() {
  // сохраняем позицию и фиксируем body — работает на iOS
  scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollLockY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.documentElement.classList.add('no-scroll');
}

function unlockScroll() {
  // возвращаем позицию
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.documentElement.classList.remove('no-scroll');
  window.scrollTo(0, scrollLockY);
}

function openSidebar() {
  if (!sidebar()) return;
  sidebar().classList.add('active');
  if (backdrop()) {
    backdrop().hidden = false;
    requestAnimationFrame(() => backdrop().classList.add('active'));
  }
  lockScroll();
  if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'true');
  isOpen = true;
}

function closeSidebar() {
  if (!sidebar()) return;
  sidebar().classList.remove('active');
  if (backdrop()) {
    backdrop().classList.remove('active');
    setTimeout(() => { if (backdrop()) backdrop().hidden = true; }, 300);
  }
  if (menuBtn()) menuBtn().setAttribute('aria-expanded', 'false');
  unlockScroll();
  isOpen = false;
}

function toggleSidebar() {
  isOpen ? closeSidebar() : openSidebar();
}
window.toggleSidebar = toggleSidebar; // для кнопки в HTML

// === Закрытие по кликам ===
document.addEventListener('click', e => {
  // клик по ссылке в сайдбаре — закрываем
  if (e.target.closest('#sidebar a')) closeSidebar();
  // клик по фону — закрываем
  if (backdrop() && e.target === backdrop()) closeSidebar();
});

// === Закрытие по Esc ===
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isOpen) closeSidebar();
});

// === Закрытие при скролле / свайпе / колесике ===
// на некоторых iOS скролл не всплывает — добавляем несколько слушателей
const closeOnUserMove = () => { if (isOpen) closeSidebar(); };

window.addEventListener('scroll', closeOnUserMove, { passive: true });
window.addEventListener('wheel',  closeOnUserMove, { passive: true });
window.addEventListener('touchmove', closeOnUserMove, { passive: true });

// иногда скролл слушается только на уровне документа/бади
document.addEventListener('scroll', closeOnUserMove, { passive: true });
document.body.addEventListener('touchmove', closeOnUserMove, { passive: true });

// === Закрытие при изменении экрана ===
window.addEventListener('resize', closeOnUserMove);
window.addEventListener('orientationchange', closeOnUserMove);

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