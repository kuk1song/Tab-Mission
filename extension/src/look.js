// look.js: the look chosen on the settings page, set before the first paint
// so the window never flashes the other colors. A plain script in <head>:
// background.js puts the choice in this page's address (overviewPath).
(() => {
  const params = new URLSearchParams(location.search);
  const look = params.get('look');
  if (look === 'light' || look === 'dark') document.documentElement.dataset.appearance = look;
  // The cards spread out (the setting): the toolbar is a search box alone in
  // the middle from the first paint (overview.css).
  if (params.get('layout') === 'spread') {
    document.documentElement.dataset.spread = '';
    // The two switches beside it, as chosen: with short words, or as icons.
    const bar = params.get('bar');
    if (bar === 'short' || bar === 'icons') document.documentElement.dataset.bar = bar;
  }
  // A trial (src/host.js): the overview as a tab, or in a frame on a page.
  const host = params.get('host');
  if (host === 'tab' || host === 'page') document.documentElement.dataset.host = host;
  // 'page' shows once backdrop.js has the picture (overview.css). People
  // who ask their system for less transparency or more contrast, or use
  // forced colors, keep the plain background.
  const backdrop = params.get('backdrop');
  const plain = ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)', '(forced-colors: active)']
    .some((query) => matchMedia(query).matches);
  if ((backdrop === 'page' || backdrop === 'wallpaper') && !plain) document.documentElement.dataset.backdrop = backdrop;
})();
