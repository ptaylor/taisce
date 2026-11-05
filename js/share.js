// Sharing a note is a Dropbox link. There are two formats, chosen in Settings:
//
//   PDF       a generated copy beside the note. It is replaced in the background
//             after the note changes; the file path, and so the link, stays the
//             same.
//   Markdown  the note itself, always current because Dropbox serves the file.
//
// A Dropbox shared link is the one thing a recipient needs no account for: the
// file stays in your own Dropbox, the link is read-only, and revoking it in
// Dropbox ends the sharing without touching the note. PDF is the default
// because Dropbox previews it in the browser, while a shared .md opens as plain
// text.
//
// Handing the *file* to the phone's share sheet is deliberately not attempted:
// Chromium whitelists the extensions it will hand over, and `.md` is not on the
// list, so it fails after the app has already promised it worked.

export const SHARE_FORMAT_KEY = 'taisce.shareFormat';
export const SHARE_RECORDS_KEY = 'taisce.sharedPdfs';
export const DEFAULT_SHARE_FORMAT = 'pdf';

/** The stored format, with anything unrecognised falling back to PDF. */
export function shareFormatChoice(raw) {
  return String(raw || '').toLowerCase() === 'markdown' ? 'markdown' : DEFAULT_SHARE_FORMAT;
}

/**
 * A cheap, stable fingerprint of the text that was rendered. It only has to
 * answer "is this the same note we last published?", and a collision would
 * hide a needed republish, so it mixes the length and two independent hashes
 * rather than trusting a single 32-bit value.
 */
export function shareFingerprint(text) {
  const value = String(text ?? '');
  let fnv = 0x811c9dc5;
  let mix = 0x9e3779b1;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    mix = Math.imul(mix ^ code, 0x85ebca6b);
  }
  return `${value.length.toString(36)}-${(fnv >>> 0).toString(36)}-${(mix >>> 0).toString(36)}`;
}

/**
 * The key a note's published record is stored under: its lowercase path.
 * Records predate the app keeping Dropbox's display case, and Dropbox is not
 * case-sensitive, so `/My Trip.md` and `/my trip.md` are one note — and one
 * record — whichever spelling the app is holding.
 */
export function shareKey(path) {
  return String(path || '').toLowerCase();
}

/** Parse the per-browser record of PDFs this device has published. */
export function parseShareRecords(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const records = {};
    for (const [path, record] of Object.entries(value)) {
      if (!path || !record || typeof record.hash !== 'string') continue;
      records[path] = { hash: record.hash, at: Number(record.at) || 0 };
    }
    return records;
  } catch {
    return {};
  }
}

const MAX_SHARE_RECORDS = 200;

/** Remember what was published, dropping the oldest records beyond a bound. */
export function recordPdfShare(records, path, hash, at = Date.now()) {
  const next = { ...records, [path]: { hash, at } };
  const entries = Object.entries(next);
  if (entries.length <= MAX_SHARE_RECORDS) return next;
  entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  return Object.fromEntries(entries.slice(0, MAX_SHARE_RECORDS));
}

/** Forget a note's published copy, so a new file at the same path starts clean. */
export function forgetPdfShare(records, path) {
  if (!(path in records)) return records;
  const next = { ...records };
  delete next[path];
  return next;
}

/**
 * True when this note has a PDF behind a shared link whose contents no longer
 * match. A note that has never been shared has no record: the first share is
 * not a republish.
 */
export function pdfNeedsPublish(records, path, text) {
  const record = path ? records[path] : null;
  return Boolean(record) && record.hash !== shareFingerprint(text);
}


/**
 * A Dropbox link opens the file's preview page when `dl=0` and downloads it
 * when `dl=1`. Sharing a note means letting someone read it, so the preview is
 * the one to send.
 */
export function viewableLink(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('dl', '0');
    return parsed.toString();
  } catch {
    return url;
  }
}

/** True when this device has a share sheet to hand a link to. */
export function canShare() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** What the share sheet is given: the note's name, and the link. */
export function sharePayload(name, url) {
  return { title: `${name} — Taisce`, text: name, url };
}
