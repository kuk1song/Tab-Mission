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
  }
  // The entrance waits, at its first frame, until the cards in view have
  // their pictures (main.js lets it go; overview.css).
  document.documentElement.dataset.wait = '';
  // A trial (src/host.js): the overview in a frame on a page.
  if (params.get('host') === 'page') document.documentElement.dataset.host = 'page';
  // 'page' shows once backdrop.js has the picture (overview.css). People
  // who ask their system for less transparency or more contrast, or use
  // forced colors, keep the plain background.
  const backdrop = params.get('backdrop');
  const plain = ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)', '(forced-colors: active)']
    .some((query) => matchMedia(query).matches);
  if ((backdrop === 'page' || backdrop === 'wallpaper') && !plain) document.documentElement.dataset.backdrop = backdrop;
})();
