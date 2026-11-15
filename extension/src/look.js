// look.js: the look chosen on the settings page, set before the first paint
// so the window never flashes the other colors. A plain script in <head>:
// background.js puts the choice in this page's address (overviewPath).
(() => {
  const params = new URLSearchParams(location.search);
  const look = params.get('look');
  if (look === 'light' || look === 'dark') document.documentElement.dataset.appearance = look;
  // 'wait' until backdrop.js has the picture, then 'on'.
  if (params.get('frost') === '1') document.documentElement.dataset.frost = 'wait';
})();
