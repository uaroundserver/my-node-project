// pwa.js — безопасный
(function () {
  // ---- настройки по умолчанию ----
  const FALLBACK_COLOR = '#0f1b2d'; // цвет шапки по умолчанию

  // троттлинг обновлений (мс)
  const TICK = 120;

  // ---- утилиты ----
  const TRANSP = new Set(['transparent', 'rgba(0, 0, 0, 0)', 'rgb(0, 0, 0, 0)']);

  function ensureMeta(name, content) {
    let m = document.querySelector(`meta[name="${name}"]`);
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', name);
      document.head.appendChild(m);
    }
    if (content != null) m.setAttribute('content', content);
    return m;
  }

  function isTransparent(c) { return !c || TRANSP.has(c.toLowerCase()); }

  function getEffectiveBG(el) {
    try {
      let n = el;
      while (n && n !== document.documentElement) {
        const cs = getComputedStyle(n);
        if (!isTransparent(cs.backgroundColor)) return cs.backgroundColor;
        if (cs.backgroundImage !== 'none') break; // есть градиент — выходим на фон документа
        n = n.parentElement;
      }
      const bodyBG = getComputedStyle(document.body).backgroundColor;
      return !isTransparent(bodyBG)
        ? bodyBG
        : getComputedStyle(document.documentElement).backgroundColor || FALLBACK_COLOR;
    } catch { return FALLBACK_COLOR; }
  }

  function setThemeColor(color) {
    try {
      ensureMeta('theme-color', color).setAttribute('content', color);
    } catch { /* no-op */ }
  }

  function getTopElement() {
    // приоритетно: .top-bar, затем header/nav, иначе точка под статус-баром
    const cand = document.querySelector('.top-bar, header, nav');
    if (cand) return cand;
    return document.elementFromPoint(Math.max(1, innerWidth / 2), 1) || document.body;
  }

  let scheduled = false, lastRun = 0;
  function scheduleUpdate() {
    const now = Date.now();
    if (scheduled && now - lastRun < TICK) return;
    scheduled = true;
    requestAnimationFrame(() => {
      try {
        const el = getTopElement();
        const color = getEffectiveBG(el) || FALLBACK_COLOR;
        setThemeColor(color);
      } catch {
        setThemeColor(FALLBACK_COLOR);
      } finally {
        lastRun = Date.now();
        scheduled = false;
      }
    });
  }

  // ---- стартуем только после полной загрузки ----
  window.addEventListener('load', () => {
    try {
      // обязательные мета для PWA на iOS (не мешают обычному Safari)
      ensureMeta('apple-mobile-web-app-capable', 'yes');
      ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');

      // первое обновление
      scheduleUpdate();

      // события
      window.addEventListener('scroll', scheduleUpdate, { passive: true });
      window.addEventListener('resize', scheduleUpdate);
      window.addEventListener('hashchange', scheduleUpdate);
      window.addEventListener('popstate', scheduleUpdate);

      // мягкий наблюдатель за DOM (без тяжёлых мутаций)
      const mo = new MutationObserver(() => scheduleUpdate());
      mo.observe(document.body, { attributes: true, childList: true, subtree: true });
    } catch {
      // в крайнем случае ставим запасной цвет и молчим
      setThemeColor(FALLBACK_COLOR);
    }
  });
})();