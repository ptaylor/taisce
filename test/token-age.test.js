import test from 'node:test';
import assert from 'node:assert/strict';

// js/auth.js reads these lazily, so a minimal stub is enough to exercise the
// token-age gate in Node.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

const { accessToken, isSignedIn, sessionState, signOut, store } = await import('../js/auth.js');

const DAY = 24 * 60 * 60 * 1000;

function seed({ refresh = null, access = null, savedAt = null, days = null } = {}) {
  memory.clear();
  if (refresh) memory.set('taisce.refresh', refresh);
  if (access) {
    memory.set('taisce.access', JSON.stringify({ token: access, expires: Date.now() + 3_600_000 }));
  }
  if (savedAt !== null) memory.set('taisce.tokensSavedAt', String(savedAt));
  if (days !== null) memory.set('taisce.tokenDays', String(days));
}

function stubFetch(handler = () => ({ ok: true, status: 200, json: async () => ({}) })) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), auth: options.headers?.Authorization });
    return handler(String(url), options);
  };
  return calls;
}

test('a fresh sign-in is signed in and is not revoked', () => {
  seed({ refresh: 'refresh-token', savedAt: Date.now() - 10 * DAY });
  const calls = stubFetch();

  assert.equal(sessionState(), 'signed-in');
  assert.equal(isSignedIn(), true);
  assert.equal(calls.length, 0);
});

test('the default limit retires a sign-in at 180 days and clears every token', () => {
  seed({
    refresh: 'refresh-token',
    access: 'access-token',
    savedAt: Date.now() - 181 * DAY,
  });
  const calls = stubFetch();

  assert.equal(sessionState(), 'expired');
  assert.equal(isSignedIn(), false);
  assert.equal(memory.has('taisce.refresh'), false);
  assert.equal(memory.has('taisce.access'), false);
  assert.equal(memory.has('taisce.tokensSavedAt'), false);
  assert.deepEqual(calls.map((call) => call.auth), ['Bearer refresh-token']);
});

test('the configured number of days decides when the sign-in is retired', () => {
  seed({ refresh: 'refresh-token', savedAt: Date.now() - 31 * DAY, days: 30 });
  stubFetch();

  assert.equal(isSignedIn(), false);
  assert.equal(memory.has('taisce.refresh'), false);

  seed({ refresh: 'refresh-token', savedAt: Date.now() - 29 * DAY, days: 30 });
  assert.equal(isSignedIn(), true);
});

test('a sign-in saved before this limit existed cannot prove its age, so it expires', () => {
  seed({ refresh: 'refresh-token' });
  stubFetch();

  assert.equal(sessionState(), 'expired');
  assert.equal(isSignedIn(), false);
  assert.equal(memory.has('taisce.refresh'), false);
});

test('an offline revoke still signs out and forgets the tokens', () => {
  seed({ refresh: 'refresh-token', savedAt: Date.now() - 200 * DAY });
  globalThis.fetch = async () => {
    throw new Error('offline');
  };

  assert.equal(isSignedIn(), false);
  assert.equal(memory.has('taisce.refresh'), false);
  assert.equal(memory.has('taisce.tokensSavedAt'), false);
});

test('a stale cached access token is refused before it is ever used', async () => {
  seed({
    refresh: 'refresh-token',
    access: 'access-token',
    savedAt: Date.now() - 200 * DAY,
  });
  stubFetch();

  await assert.rejects(() => accessToken('app-key'), /sign-in expired/);
  assert.equal(memory.has('taisce.access'), false);
  assert.equal(memory.has('taisce.refresh'), false);
});

test('refreshing the access token does not restart the sign-in clock', async () => {
  seed({ refresh: 'refresh-token', savedAt: Date.now() - 100 * DAY });
  const before = store.savedAt;
  stubFetch(() => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'new-access', expires_in: 14400 }),
  }));

  assert.equal(await accessToken('app-key'), 'new-access');
  assert.equal(store.savedAt, before, 'a refresh is not a new sign-in');
});

test('a rotated refresh token replaces the old one without moving the clock', async () => {
  seed({ refresh: 'old-refresh', savedAt: Date.now() - 100 * DAY });
  const before = store.savedAt;
  stubFetch(() => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 14400 }),
  }));

  await accessToken('app-key');
  assert.equal(store.refresh, 'new-refresh');
  assert.equal(store.savedAt, before);
});

test('signing out forgets the saved date as well as the tokens', () => {
  seed({ refresh: 'refresh-token', access: 'access-token', savedAt: Date.now() });
  signOut();

  assert.equal(memory.size, 0);
  assert.equal(sessionState(), 'signed-out');
});
