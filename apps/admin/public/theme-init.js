/* global window, document */
// Runs before first paint: applies the theme saved by the admin's theme store (key and shape must match
// src/stores/theme.ts), falling back to the OS preference. Storage can be unavailable (private mode).
(function () {
  var preference = 'system';
  try {
    var saved = JSON.parse(window.localStorage.getItem('shapio.theme') || 'null');
    if (saved && saved.state && typeof saved.state.preference === 'string') {
      preference = saved.state.preference;
    }
  } catch {
    preference = 'system';
  }
  var dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
