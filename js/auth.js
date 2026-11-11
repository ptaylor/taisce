import { AuthError } from './errors.js';
import { tokenAgeDays, tokenExpired, TOKEN_AGE_KEY } from './tokens.js';

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke';
const REFRESH_KEY = 'taisce.refresh';
const ACCESS_KEY = 'taisce.access';
const SAVED_KEY = 'taisce.tokensSavedAt';
const VERIFIER_KEY = 'taisce.verifier';
const STATE_KEY = 'taisce.state';

export function b64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

/**
 * The redirect URI must match one registered in the Dropbox App Console
 * character for character, trailing slash included.
 */
export function redirectUri(location = globalThis.location) {
  return location.origin + location.pathname;
}

export const store = {
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set refresh(value) {
    if (value) localStorage.setItem(REFRESH_KEY, value);
    else localStorage.removeItem(REFRESH_KEY);
  },
  get access() {
    try {
      return JSON.parse(localStorage.getItem(ACCESS_KEY) || 'null');
    } catch {
      return null;
    }
  },
  set access(value) {
    if (value) localStorage.setItem(ACCESS_KEY, JSON.stringify(value));
    else localStorage.removeItem(ACCESS_KEY);
  },
  get savedAt() {
    const saved = Number(localStorage.getItem(SAVED_KEY));
    return saved > 0 ? saved : null;
  },
  set savedAt(value) {
    if (value) localStorage.setItem(SAVED_KEY, String(value));
    else localStorage.removeItem(SAVED_KEY);
  },
};

export async function startSignIn(appKey) {
  const verifier = randomVerifier();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));

  // Both stores: the return from Dropbox is a fresh page load, and one of them
  // is unavailable in some private-mode/browser combinations.
  for (const storage of [localStorage, sessionStorage]) {
    storage.setItem(VERIFIER_KEY, verifier);
    storage.setItem(STATE_KEY, state);
  }

  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirectUri(),
    state,
  }).toString();

  location.href = url.toString();
}

function clearPkce() {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem(VERIFIER_KEY);
    storage.removeItem(STATE_KEY);
  }
}

/**
 * Handles the redirect back from Dropbox. Returns true when the page has just
 * completed a sign-in.
 */
export async function completeSignIn(appKey) {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return false;

  history.replaceState({}, '', location.pathname + location.hash);

  if (error) throw new AuthError(params.get('error_description') || error);

  const verifier = localStorage.getItem(VERIFIER_KEY) || sessionStorage.getItem(VERIFIER_KEY);
  const expected = localStorage.getItem(STATE_KEY) || sessionStorage.getItem(STATE_KEY);
  clearPkce();

  if (!verifier) throw new AuthError('missing PKCE verifier — start the sign-in again');
  if (expected && params.get('state') !== expected) {
    throw new AuthError('state mismatch — start the sign-in again');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: appKey,
      code_verifier: verifier,
      redirect_uri: redirectUri(),
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(body.error_description || body.error || `sign-in failed (${res.status})`);

  store.refresh = body.refresh_token || null;
  // The clock starts at sign-in, not at each four-hourly access-token refresh:
  // restarting it on refresh would mean a regularly used device never reaches
  // the configured limit.
  store.savedAt = body.refresh_token ? Date.now() : null;
  store.access = {
    token: body.access_token,
    expires: Date.now() + (body.expires_in || 14400) * 1000,
  };
  return true;
}

export function configuredTokenDays() {
  return tokenAgeDays(localStorage.getItem(TOKEN_AGE_KEY));
}

/** 'signed-out' | 'expired' | 'signed-in'. Does not change the store. */
export function sessionState(now = Date.now()) {
  if (!store.refresh && !store.access) return 'signed-out';
  return tokenExpired(store.savedAt, now, configuredTokenDays()) ? 'expired' : 'signed-in';
}

async function revokeGrant(token) {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Offline or already invalid: the local sign-out still applies.
  }
}

/**
 * Forget a sign-in that has outlived the configured limit. Returns true when
 * there was one to retire. The grant is offered to Dropbox for revocation as
 * well, so a token copied off this origin before the limit is reached stops
 * working at the same time as the local copy.
 */
export function retireOldTokens(now = Date.now()) {
  if (sessionState(now) !== 'expired') return false;
  const grant = store.refresh || store.access?.token;
  signOut();
  // Deliberately not awaited: isSignedIn() is synchronous, and an offline
  // revoke must not hold up the sign-out or the screen that follows it.
  if (grant) void revokeGrant(grant);
  return true;
}

export async function accessToken(appKey) {
  if (retireOldTokens()) throw new AuthError('sign-in expired — connect again');
  const cached = store.access;
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  if (!store.refresh) throw new AuthError('not signed in');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: store.refresh,
      client_id: appKey,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'invalid_grant') {
      signOut();
      throw new AuthError('session expired');
    }
    throw new AuthError(body.error_description || body.error || 'token refresh failed');
  }

  const body = await res.json();
  // A rotated refresh token replaces the old one without moving the sign-in's
  // saved date: rotation is not a new sign-in.
  if (body.refresh_token) store.refresh = body.refresh_token;
  store.access = {
    token: body.access_token,
    expires: Date.now() + (body.expires_in || 14400) * 1000,
  };
  return store.access.token;
}

export function isSignedIn() {
  if (retireOldTokens()) return false;
  return Boolean(store.refresh);
}

/** Forget the tokens on this device. Does not revoke them with Dropbox. */
export function signOut() {
  store.refresh = null;
  store.access = null;
  store.savedAt = null;
}
