import { joinPath, normaliseDir, parentDir } from './paths.js';

// Pasted images live beside the note, in an `assets` folder, and the note links
// them relatively so the same file works in any Markdown editor with the
// Dropbox folder checked out.

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

export function imageExtension(type) {
  return EXTENSIONS[String(type || '').toLowerCase()] || 'png';
}

export function imageFileName(type, now = Date.now()) {
  const date = new Date(now);
  const pad = (value) => String(value).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}.${imageExtension(type)}`;
}

/** The folder that holds images for a given note. */
export function assetDirFor(filePath) {
  return joinPath(parentDir(filePath), 'assets');
}

export function markdownImage(name) {
  return `![](assets/${name})`;
}

/**
 * The Dropbox path an image reference points at, or null when it is not a
 * relative reference we can resolve (http(s), data:, blob:, or empty).
 */
export function resolveImagePath(filePath, src) {
  const raw = String(src || '').trim();
  if (!raw) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return null;

  const withoutQuery = decodeURIComponent(raw.split('#')[0].split('?')[0]);
  if (withoutQuery.startsWith('/')) return normaliseDir(withoutQuery) || null;
  return joinPath(parentDir(filePath), withoutQuery.replace(/^\.\//, ''));
}
