import test from 'node:test';
import assert from 'node:assert/strict';

// js/auth.js reads these lazily, so a minimal stub is enough to exercise the
// provider in Node.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

const { DropboxProvider } = await import('../js/dropbox.js');

function seed({ refresh = null, access = null } = {}) {
  memory.clear();
  if (refresh) memory.set('taisce.refresh', refresh);
  if (access) memory.set('taisce.access', JSON.stringify({ token: access, expires: Date.now() + 3_600_000 }));
}

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), auth: options.headers?.Authorization });
    return handler(String(url), options);
  };
  return calls;
}

test('disconnect offers Dropbox the refresh token first, then the access token', async () => {
  seed({ refresh: 'refresh-token', access: 'access-token' });
  const calls = stubFetch(() => ({ ok: true, status: 200 }));

  await new DropboxProvider('app-key').disconnect();

  assert.equal(calls.length, 1, 'stops after the first successful revoke');
  assert.match(calls[0].url, /auth\/token\/revoke$/);
  assert.equal(calls[0].auth, 'Bearer refresh-token');
  assert.equal(memory.has('taisce.refresh'), false);
  assert.equal(memory.has('taisce.access'), false);
});

test('a rejected refresh token falls back to the access token', async () => {
  seed({ refresh: 'refresh-token', access: 'access-token' });
  const calls = stubFetch((url, options) => ({
    ok: options.headers.Authorization === 'Bearer access-token',
    status: options.headers.Authorization === 'Bearer access-token' ? 200 : 401,
  }));

  await new DropboxProvider('app-key').disconnect();

  assert.deepEqual(
    calls.map((call) => call.auth),
    ['Bearer refresh-token', 'Bearer access-token'],
  );
  assert.equal(memory.has('taisce.refresh'), false);
});

test('disconnecting offline still forgets the tokens locally', async () => {
  seed({ refresh: 'refresh-token' });
  globalThis.fetch = async () => {
    throw new Error('offline');
  };

  await new DropboxProvider('app-key').disconnect();

  assert.equal(memory.has('taisce.refresh'), false);
});
