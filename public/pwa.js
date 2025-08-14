(function () {
  // --- 1) Обеспечиваем нужные meta для iOS PWA ---
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

  ensureMeta('apple-mobile-web-app-capable', 'yes');
  ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  // theme-color создадим/обновим динамически ниже

  // --- 2) Хелперы ---
  const TRANSPARENT = ['transparent', 'rgba(0, 0, 0, 0)', 'rgb(0, 0, 0, 0)'];

  function isTransparent(c) { return !c || TRANSPARENT.includes(c.toLowerCase()); }

  // Идём вверх по дереву, пока не найдём непрозрачный фон
  function getEffectiveBG(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      if (!isTransparent(cs.backgroundColor) || cs.backgroundImage !== 'none') {
        // Если есть градиент — берём цвет текущего узла (обычно body/html задаёт базу)
        if (cs.backgroundImage !== 'none') {
          // fallback: цвет документа
          const bodyBG = getComputedStyle(document.body).backgroundColor;
          return isTransparent(bodyBG) ? getComputedStyle(document.documentElement).backgroundColor : bodyBG;
        }
        return cs.backgroundColor;
      }
      node = node.parentElement;
    }
    // Фолбэк: body или html
    const bodyBG = getComputedStyle(document.body).backgroundColor;
    return isTransparent(bodyBG)
      ? getComputedStyle(document.documentElement).backgroundColor
      : bodyBG;
  }

  function setThemeColor(color) {
    const tag = ensureMeta('theme-color', color);
    tag.setAttribute('content', color);
    // Для Safari в обычном режиме полезно продублировать с media
    ensureMeta('theme-color', color).setAttribute('media', '(prefers-color-scheme: light)');
  }

  // Если есть фиксированный верхний бар — приоритетно берём его
  function getTopElement() {
    const candidate = document.querySelector('.top-bar, header, nav');
    if (candidate) return candidate;
    return document.elementFromPoint(window.innerWidth / 2, 1) || document.body;
  }

  function updateFromTop() {
    const el = getTopElement();
    const color = getEffectiveBG(el);
    if (color) setThemeColor(color);
  }

  // --- 3) События обновления ---
  window.addEventListener('load', updateFromTop, { once: true });
  window.addEventListener('scroll', updateFromTop, { passive: true });
  window.addEventListener('resize', updateFromTop);

  // Обновляем при SPA-навигации и изменениях DOM/темы
  window.addEventListener('hashchange', updateFromTop);
  window.addEventListener('popstate', updateFromTop);
  const mo = new MutationObserver(() => updateFromTop());
  mo.observe(document.documentElement, { attributes: true, childList: true, subtree: true });

  // Первое мгновенное значение (на случай, если load задержится)
  requestAnimationFrame(updateFromTop);
})();