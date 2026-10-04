/* global window, document */
// Runs before first paint: applies the look saved by the admin's theme store (key, shape and migration must
// match src/stores/theme.ts; the built-in variants repeat src/constants/themes.ts; the resolution repeats
// src/helpers/theme.ts resolveScheme; src/test/themeInit.test.ts keeps them in step). Sets `data-theme` and
// the `dark` class on <html>. Nothing follows the operating system. Storage can be unavailable (private
// mode): the default is Shapio.
(function () {
  var BUILT_IN = {
    shapio: ['dark'],
    classic: ['dark'],
    'murdered-out': ['dark'],
    forest: ['dark'],
    snowed: ['light'],
    butter: ['light'],
  };
  var theme = 'shapio';
  var appearance = 'dark';
  var variants = ['dark'];
  try {
    var saved = JSON.parse(window.localStorage.getItem('shapio.theme') || 'null');
    var state = saved && saved.state;
    if (state && typeof saved.version === 'number' && saved.version >= 2) {
      if (typeof state.theme === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(state.theme)) {
        theme = state.theme;
      }
      appearance = state.appearance;
      if (Array.isArray(state.variants)) {
        var cached = ['light', 'dark'].filter(function (variant) {
          return state.variants.indexOf(variant) !== -1;
        });
        if (cached.length > 0) {
          variants = cached;
        }
      }
    } else if (state) {
      // Version 1 (before themes): the original palette, now the Cobalt look.
      theme = 'classic';
    }
  } catch {
    theme = 'shapio';
    appearance = 'dark';
  }
  if (Object.prototype.hasOwnProperty.call(BUILT_IN, theme)) {
    variants = BUILT_IN[theme];
  }
  if (appearance !== 'light' && appearance !== 'dark') {
    appearance = variants[0];
  }
  var scheme = variants.indexOf(appearance) !== -1 ? appearance : variants[0];
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.toggle('dark', scheme === 'dark');
})();
