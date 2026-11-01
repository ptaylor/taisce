// Usage measurement, in one place.
//
// GoatCounter, via the vendored `vendor/count.js`. Every call is guarded: the
// script is absent when the page is offline, when a content blocker removes it,
// or when `configure()` has switched counting off. Nothing here may throw — an
// analytics failure must never break an edit.
//
// Two rules hold the privacy promise:
//   1. Event paths are categorical slugs and nothing else. Never a file name, a
//      folder, a URL from a note, or a search term.
//   2. The app has no URL routing, so the query string GoatCounter sends with
//      each hit can never contain a note's path. Keep it that way: if routing is
//      ever added, pass `referrer`/`path` explicitly and strip the query.

const VERSION_META = 'meta[name="app-version"]';

let enabled = true;

/** `"v0.16"` → `"v0-16"`, the slug GoatCounter paths use for a release. */
export function versionSlug(version) {
  return String(version || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '-');
}

/** The release this build came from, or '' when the meta tag is missing. */
export function releaseSlug(document = globalThis.document) {
  const content = document?.querySelector?.(VERSION_META)?.content;
  return content ? versionSlug(content) : '';
}

/** Turn counting off entirely — the demo does this, so trials stay out of the numbers. */
export function configure({ demo = false } = {}) {
  enabled = !demo;
}

export function isEnabled() {
  return enabled;
}

function counter() {
  if (!enabled) return null;
  return globalThis.window?.goatcounter ?? null;
}

/** A pageview. The app is one page, so this fires once per visit. */
export function trackView(path) {
  const goat = counter();
  if (!goat) return;
  try {
    goat.count({ path });
  } catch {
    // Blocked or not ready: a visit is not worth an error.
  }
}

/** A categorical event, e.g. `trackEvent('share-copy')`. */
export function trackEvent(path) {
  const goat = counter();
  if (!goat) return;
  try {
    goat.count({ path, event: true });
  } catch {
    // As above.
  }
}
