(function () {
  // Функция обновления meta theme-color
  function setThemeColor(color) {
    let metaTag = document.querySelector('meta[name="theme-color"]');
    if (!metaTag) {
      metaTag = document.createElement('meta');
      metaTag.name = 'theme-color';
      document.head.appendChild(metaTag);
    }
    metaTag.setAttribute('content', color);
  }

  // Получаем цвет верхней части страницы
  function updateFromTop() {
    // Берём элемент, который "лежит" в верхней части
    const elementOnTop = document.elementFromPoint(window.innerWidth / 2, 1);
    if (elementOnTop) {
      const style = getComputedStyle(elementOnTop);
      const bgColor = style.backgroundColor;
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)') {
        setThemeColor(bgColor);
      } else {
        // Если фон прозрачный — берём фон body
        setThemeColor(getComputedStyle(document.body).backgroundColor);
      }
    }
  }

  // Обновляем при загрузке, скролле и ресайзе
  window.addEventListener('load', updateFromTop);
  window.addEventListener('scroll', updateFromTop);
  window.addEventListener('resize', updateFromTop);
})();