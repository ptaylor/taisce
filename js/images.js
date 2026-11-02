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

export function imageFileName(type, now = Date.now(), suffix = '') {
  const date = new Date(now);
  const pad = (value) => String(value).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const tail = suffix ? `-${suffix}` : '';
  return `${stamp}${tail}.${imageExtension(type)}`;
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

  const withoutQuery = decodeURIComponent(raw.split('#')[0].split('?')[0]).replace(/^(?:\.\/)+/, '');

  // A note may only point at a sibling asset, never walk out of its folder.
  if (withoutQuery.split('/').some((part) => part === '..' || part === '.')) return null;

  if (withoutQuery.startsWith('/')) return normaliseDir(withoutQuery) || null;
  return joinPath(parentDir(filePath), withoutQuery);
}

// How a picture is written in a note: Markdown, or the raw HTML the renderer
// also hydrates. Both end up as <img> elements, so both are pictures a note
// carries. The span is kept as well as the source, because deleting a picture
// means deleting the markup that points at it.
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
const HTML_IMAGE = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;

/**
 * Every picture reference in a note, in source order.
 * @param {string} source
 * @returns {{form: 'markdown'|'html', start: number, end: number, src: string}[]}
 */
export function findImageRefs(source) {
  const text = String(source || '');
  const refs = [];

  for (const match of text.matchAll(MARKDOWN_IMAGE)) {
    refs.push({
      form: 'markdown',
      start: match.index,
      end: match.index + match[0].length,
      src: match[1],
    });
  }
  for (const match of text.matchAll(HTML_IMAGE)) {
    refs.push({
      form: 'html',
      start: match.index,
      end: match.index + match[0].length,
      src: match[1] || match[2] || match[3],
    });
  }

  return refs.sort((a, b) => a.start - b.start);
}

/** The source with one picture's markup taken out. */
export function removeImageRef(source, ref) {
  return source.slice(0, ref.start) + source.slice(ref.end);
}

/**
 * The pictures a note carries, as Dropbox paths.
 *
 * "Attached" means written in this note as a relative reference, which is the
 * only kind the app itself creates — a pasted picture lands in `assets/` with a
 * timestamped name and is linked relatively. Remote images are not attached
 * (they are not in Dropbox), and neither is anything outside the note's folder.
 *
 * Deleting a note takes these with it, and assumes a picture belongs to one
 * note. A name collision would break that, so pasted names carry a timestamp
 * and a random suffix.
 *
 * @param {string} filePath the note's own path
 * @param {string} text the note's Markdown
 * @returns {string[]} unique Dropbox paths, excluding the note itself
 */
export function attachedImages(filePath, text) {
  const found = new Set();
  const own = String(filePath || '').toLowerCase();

  for (const ref of findImageRefs(text)) {
    const path = resolveImagePath(filePath, ref.src);
    if (!path || path.toLowerCase() === own) continue;
    found.add(path);
  }

  return [...found];
}
