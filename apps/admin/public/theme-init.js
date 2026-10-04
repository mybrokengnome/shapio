/* global window, document */
// Runs before first paint: applies the theme saved by the admin's theme store (key and shape must match
// src/stores/theme.ts; the resolution repeats src/helpers/theme.ts resolveScheme, and
// src/test/themeInit.test.ts keeps them in step). Sets `data-theme` and the `dark` class on <html>.
// Storage can be unavailable (private mode): the default is Shapio, following the OS.
(function () {
  var theme = 'shapio';
  var appearance = 'system';
  var variants = ['light', 'dark'];
  try {
    var saved = JSON.parse(window.localStorage.getItem('shapio.theme') || 'null');
    var state = saved && saved.state;
    if (state && typeof saved.version === 'number' && saved.version >= 2) {
      if (typeof state.theme === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(state.theme)) {
        theme = state.theme;
      }
      if (typeof state.appearance === 'string') {
        appearance = state.appearance;
      }
      if (Array.isArray(state.variants)) {
        var cached = ['light', 'dark'].filter(function (variant) {
          return state.variants.indexOf(variant) !== -1;
        });
        if (cached.length > 0) {
          variants = cached;
        }
      }
    } else if (state) {
      // Version 1 (before themes): the original palette, now called Classic.
      theme = 'classic';
      if (typeof state.preference === 'string') {
        appearance = state.preference;
      }
    }
  } catch {
    theme = 'shapio';
  }
  if (appearance !== 'light' && appearance !== 'dark') {
    appearance = 'system';
  }
  var preferred =
    appearance === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : appearance;
  var scheme = variants.indexOf(preferred) !== -1 ? preferred : variants[0];
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.toggle('dark', scheme === 'dark');
})();
