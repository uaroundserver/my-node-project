// pwa.js — подключи его в <head> на всех страницах
(function () {
  // Цвета для жёлто-синей темы (верх статус-бара и theme-color)
  const themeColor = '#0057b7'; // синий
  const backgroundColor = '#ffd700'; // жёлтый

  const metaData = [
    { name: 'theme-color', content: themeColor }, // Android + новые iOS
    { name: 'apple-mobile-web-app-capable', content: 'yes' }, // iOS PWA
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }, // прозрачный статус-бар
    { name: 'apple-mobile-web-app-title', content: 'UAround' }
  ];

  // Добавляем meta-теги
  metaData.forEach(tag => {
    const m = document.createElement('meta');
    m.name = tag.name;
    m.content = tag.content;
    document.head.appendChild(m);
  });

  // Добавляем иконку для iOS
  const link = document.createElement('link');
  link.rel = 'apple-touch-icon';
  link.href = '/icons/apple-touch-icon-180.png';
  document.head.appendChild(link);

  // Красим фон body в жёлтый (чтобы через translucent выглядело)
  document.addEventListener('DOMContentLoaded', () => {
    document.body.style.backgroundColor = backgroundColor;
  });
})();