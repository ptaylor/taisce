// How long a stored Dropbox sign-in may live on this device. The long-lived
// refresh token is the credential worth ageing out: an access token lasts only
// hours, but the refresh token would otherwise sit in localStorage until the
// reader disconnected. Pure, so `node --test` can exercise it without a DOM.

export const TOKEN_AGE_KEY = 'taisce.tokenDays';
export const DEFAULT_TOKEN_AGE_DAYS = 180;
export const MAX_TOKEN_AGE_DAYS = 3650;

const DAY = 24 * 60 * 60 * 1000;

/**
 * The configured number of days, or the default when the stored value is not
 * a usable positive integer. There is no "never expire" value: a setting of 0
 * or nonsense would disable the protection silently, so it falls back instead.
 */
export function tokenAgeDays(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_TOKEN_AGE_DAYS;
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days < 1) return DEFAULT_TOKEN_AGE_DAYS;
  return Math.min(days, MAX_TOKEN_AGE_DAYS);
}

/**
 * How long ago the sign-in was saved, in milliseconds, or null when there is
 * no readable record. A future timestamp (a clock that moved backwards) counts
 * as age 0 rather than as a negative age.
 */
export function tokenAge(savedAt, now = Date.now()) {
  const saved = Number(savedAt);
  if (!Number.isFinite(saved) || saved <= 0) return null;
  return Math.max(0, now - saved);
}

/**
 * True when a sign-in saved at `savedAt` has reached the limit. A missing or
 * unreadable timestamp is expired: it cannot be shown to be recent, and the
 * safe answer for a credential is to ask for a fresh sign-in.
 */
export function tokenExpired(savedAt, now = Date.now(), days = DEFAULT_TOKEN_AGE_DAYS) {
  const age = tokenAge(savedAt, now);
  if (age === null) return true;
  return age >= tokenAgeDays(days) * DAY;
}
