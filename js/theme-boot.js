// Apply the stored theme before the first paint.
//
// This is a classic script, not a module: modules are deferred, so the page
// would paint the default palette and then switch, which is a flash in the
// dark. A classic script in the head blocks the stylesheet, so `data-theme` is
// already on <html> when the colours are first resolved.
//
// The key and the "system" rule are repeated from js/theme.js because this
// script cannot import it; keep the two in step.
(() => {
  let stored = null;
  try {
    stored = localStorage.getItem('taisce.theme');
  } catch {
    // Storage can be blocked; the device preference still works.
  }
  const choice = stored === 'dark' || stored === 'light' ? stored : 'system';
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme =
    choice === 'dark' || (choice === 'system' && prefersDark) ? 'dark' : 'light';
})();
