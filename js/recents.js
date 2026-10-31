// Recent files and search work over one flat index of every Markdown file in
// the app folder. Pure functions, so the ordering rules are testable without a
// browser or a Dropbox account.

export const RECENT_DEFAULT = 5;
export const RECENT_MIN = 1;
export const RECENT_MAX = 20;

/** Most recently modified first, capped. `modified` is a timestamp in ms. */
export function recentFiles(files, count = RECENT_DEFAULT) {
  const limit = Number.isFinite(count) ? Math.max(0, count) : RECENT_DEFAULT;
  return [...files]
    .sort((a, b) => (b.modified || 0) - (a.modified || 0) || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** Case-insensitive filename substring, never a path match. */
export function searchFiles(files, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  return files
    .filter((file) => file.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

/** Clamp a stored preference, so a hand-edited value cannot break the list. */
export function recentCount(raw) {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value)) return RECENT_DEFAULT;
  return Math.min(RECENT_MAX, Math.max(RECENT_MIN, value));
}

/** The folder a result lives in, for the second line of a search hit. */
export function folderOf(path) {
  const value = String(path || '');
  const cut = value.lastIndexOf('/');
  return cut <= 0 ? '/' : value.slice(0, cut);
}
