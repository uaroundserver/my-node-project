// Удаляет ВСЕ сервис-воркеры и кэши на текущем домене
(async () => {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // визуально подтвердим
    console.log('Service Workers & caches nuked');
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="position:fixed;top:0;left:0;right:0;padding:8px 12px;background:#111;color:#0f0;z-index:99999;font:14px/1.3 -apple-system,system-ui">SW & caches очищены. Обнови страницу.</div>');
  } catch(e){ console.warn(e); }
})();