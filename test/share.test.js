import test from 'node:test';
import assert from 'node:assert/strict';

import { canShare, sharePayload, viewableLink } from '../js/share.js';
import { DropboxProvider } from '../js/dropbox.js';
import { AuthError, ScopeError } from '../js/errors.js';

const fakeResponse = (status, body) => ({ status, text: async () => JSON.stringify(body) });

test('a shared link is sent in its viewable form', () => {
  assert.equal(
    viewableLink('https://www.dropbox.com/scl/fi/abc/note.md?rlkey=xyz&dl=1'),
    'https://www.dropbox.com/scl/fi/abc/note.md?rlkey=xyz&dl=0',
  );
  assert.equal(
    viewableLink('https://www.dropbox.com/scl/fi/abc/note.md?rlkey=xyz'),
    'https://www.dropbox.com/scl/fi/abc/note.md?rlkey=xyz&dl=0',
  );
});

test('anything that is not a URL is left alone', () => {
  assert.equal(viewableLink('not a url'), 'not a url');
  assert.equal(viewableLink(''), '');
});

test('the share sheet gets the note name and the link', () => {
  assert.deepEqual(sharePayload('notes.md', 'https://example.com/x'), {
    title: 'notes.md — Taisce',
    text: 'notes.md',
    url: 'https://example.com/x',
  });
});

test('canShare is false where there is no share sheet', () => {
  assert.equal(canShare(), false);
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: { share: () => {} },
    configurable: true,
    writable: true,
  });
  assert.equal(canShare(), true);
  if (original === undefined) delete globalThis.navigator;
  else {
    Object.defineProperty(globalThis, 'navigator', {
      value: original,
      configurable: true,
      writable: true,
    });
  }
});

test('a token without the sharing permission is not a sign-out', async () => {
  // Dropbox answers 401 for a scope the token was never granted. Forgetting the
  // token there would throw the user out of the app over one refused call.
  const provider = new DropboxProvider('test-key');
  const error = await provider.toError(
    fakeResponse(401, {
      error_summary: 'missing_scope/...',
      error: { '.tag': 'missing_scope', missing_scope: { required_scope: 'sharing.write' } },
    }),
  );
  assert.ok(error instanceof ScopeError);
  assert.ok(!(error instanceof AuthError));
});
