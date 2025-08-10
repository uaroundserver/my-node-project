function initMenu() {
  function sidebar() { return document.getElementById('sidebar'); }
  function backdrop() { return document.getElementById('menu-backdrop'); }
  function menuBtn()  { return document.getElementById('menuButton'); }

  let scrollLockY = 0;
  let isOpen = false;
  let canAutoClose = false;

  function lockScroll() {
    scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollLockY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.documentElement.classList.add('no-scroll');
  }

  function unlockScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.documentElement.classList.remove('no-scroll');
    window.scrollTo(0, scrollLockY);
  }

  function addAutoCloseListeners() {
    const closeOnMove = () => { if (isOpen && canAutoClose) closeSidebar(); };
    addAutoCloseListeners._refs = [
      ['scroll', window, closeOnMove, { passive:true }],
      ['wheel', window, closeOnMove, { passive:true }],
      ['touchmove', window, closeOnMove, { passive:true }],
      ['scroll', document, closeOnMove, { passive:true }],
      ['touchmove', document.body, closeOnMove, { passive:true }],
      ['resize', window, closeOnMove],
      ['orientationchange', window, closeOnMove],
    ];
    addAutoCloseListeners._refs.forEach(([ev, target, fn, opt]) => target.addEventListener(ev, fn, opt));
  }

  function removeAutoCloseListeners() {
    (addAutoCloseListeners._refs || []).forEach(([ev, target, fn, opt]) => {
      target.removeEventListener(ev, fn, opt);
    });
    addAutoCloseListeners._refs = [];
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

    addAutoCloseListeners();

    canAutoClose = false;
    setTimeout(() => { canAutoClose = true; }, 250);
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
    canAutoClose = false;
    removeAutoCloseListeners();
  }

  function toggleSidebar() { isOpen ? closeSidebar() : openSidebar(); }
  window.toggleSidebar = toggleSidebar;

  // --- Закрытие при клике на ссылку внутри сайдбара
  document.addEventListener('click', e => {
    if (e.target.closest('#sidebar a')) closeSidebar();
  });

  // --- Закрытие при тапе по бэкдропу
  document.addEventListener('pointerdown', e => {
    if (!isOpen) return;
    if (backdrop() && e.target === backdrop()) closeSidebar();
  });

  // --- Закрытие при тапе в любое место вне меню (capture)
  document.addEventListener('pointerdown', e => {
    if (!isOpen) return;
    if (e.target.closest('#sidebar') || e.target.closest('#menuButton')) return;
    closeSidebar();
  }, true);

  // --- Закрытие по Esc
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) closeSidebar();
  });

  // --- Подсветка активных ссылок
  (function setActiveLinks() {
    const path = location.pathname.split('/').pop() || 'home.html';
    const links = document.querySelectorAll('#bottom-nav a, #sidebar a');
    links.forEach(a => {
      try {
        const href = a.getAttribute('href') || '';
        const file = href.split('?')[0].split('#')[0];
        if (file && path === file) a.classList.add('active');
      } catch(_) {}
    });
  })();
}

// Если меню уже есть в DOM — сразу запускаем
if (document.readyState !== 'loading') {
  initMenu();
} else {
  document.addEventListener('DOMContentLoaded', initMenu);
}