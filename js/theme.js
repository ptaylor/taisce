/** The stored preference: system, dark or light. */
export const THEME_KEY = 'taisce.theme';
export const THEME_DEFAULT = 'system';

/**
 * Clamp a stored theme preference. A hand-edited or older value becomes
 * "system", so there is always a theme to apply.
 *
 * @param {string|null|undefined} raw the value read from storage
 * @returns {'system'|'dark'|'light'}
 */
export function themeChoice(raw) {
  return raw === 'dark' || raw === 'light' ? raw : THEME_DEFAULT;
}

/**
 * Resolve a choice to the theme to paint. "system" follows the device; an
 * explicit choice ignores it.
 *
 * @param {'system'|'dark'|'light'} choice
 * @param {boolean} prefersDark what the device asked for
 * @returns {'dark'|'light'}
 */
export function effectiveTheme(choice, prefersDark) {
  if (choice === 'dark' || choice === 'light') return choice;
  return prefersDark ? 'dark' : 'light';
}
