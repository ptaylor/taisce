// Sharing a note is a link, not the file itself.
//
// A Dropbox shared link is the one thing a recipient needs no account for: the
// file stays in your own Dropbox, the link is read-only, and revoking it in
// Dropbox ends the sharing without touching the file. Handing the *file* to the
// phone's share sheet is deliberately not attempted: Chromium whitelists the
// extensions it will hand over and `.md` is not on the list, so it fails after
// the app has already promised it worked.

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
