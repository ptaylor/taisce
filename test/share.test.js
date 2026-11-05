import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canShare,
  forgetPdfShare,
  parseShareRecords,
  pdfNeedsPublish,
  recordPdfShare,
  shareFingerprint,
  shareFormatChoice,
  sharePayload,
  viewableLink,
} from '../js/share.js';
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

test('sharing is PDF unless Markdown was chosen', () => {
  assert.equal(shareFormatChoice(null), 'pdf');
  assert.equal(shareFormatChoice('pdf'), 'pdf');
  assert.equal(shareFormatChoice('markdown'), 'markdown');
  assert.equal(shareFormatChoice('MARKDOWN'), 'markdown');
  assert.equal(shareFormatChoice('something else'), 'pdf');
});

test('the fingerprint follows the text, not the time', () => {
  assert.equal(shareFingerprint('hello'), shareFingerprint('hello'));
  assert.notEqual(shareFingerprint('hello'), shareFingerprint('hello!'));
  assert.notEqual(shareFingerprint(''), shareFingerprint(' '));
  assert.match(shareFingerprint('abc'), /^[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/);
});

test('share records ignore anything that is not a record', () => {
  assert.deepEqual(parseShareRecords('not json'), {});
  assert.deepEqual(parseShareRecords('[]'), {});
  assert.deepEqual(parseShareRecords('null'), {});
  assert.deepEqual(parseShareRecords('{"a.md":{"hash":1}}'), {});
  assert.deepEqual(parseShareRecords('{"a.md":{"hash":"x","at":"12"}}'), {
    'a.md': { hash: 'x', at: 12 },
  });
});

test('a changed note needs republishing only after a PDF was shared', () => {
  const text = '# Note\n\nFirst';
  const hash = shareFingerprint(text);
  assert.equal(pdfNeedsPublish({}, '/note.md', text), false);
  assert.equal(pdfNeedsPublish({ '/note.md': { hash } }, '/note.md', text), false);
  assert.equal(pdfNeedsPublish({ '/note.md': { hash } }, '/note.md', `${text}!`), true);
});

test('recording and forgetting a published PDF', () => {
  const records = recordPdfShare({}, '/note.md', 'abc', 100);
  assert.deepEqual(records, { '/note.md': { hash: 'abc', at: 100 } });
  assert.deepEqual(recordPdfShare(records, '/other.md', 'def', 200), {
    '/note.md': { hash: 'abc', at: 100 },
    '/other.md': { hash: 'def', at: 200 },
  });
  assert.deepEqual(forgetPdfShare(records, '/note.md'), {});
  assert.equal(forgetPdfShare(records, '/missing.md'), records);
});

test('the share record keeps only the newest entries', () => {
  let records = {};
  for (let index = 0; index < 205; index += 1) {
    records = recordPdfShare(records, `/note-${index}.md`, String(index), index);
  }
  assert.equal(Object.keys(records).length, 200);
  assert.equal(records['/note-0.md'], undefined);
  assert.deepEqual(records['/note-204.md'], { hash: '204', at: 204 });
});

test('republishing a PDF reuses its Dropbox link instead of minting a new one', async () => {
  const provider = new DropboxProvider('test-key');
  const calls = [];
  provider.rpc = async (endpoint) => {
    calls.push(endpoint);
    if (endpoint === 'sharing/list_shared_links') {
      return { links: [{ path_lower: '/note.pdf', url: 'https://dropbox.example/existing' }] };
    }
    throw new Error(`unexpected ${endpoint}`);
  };

  assert.equal(await provider.shareLink('/note.pdf'), 'https://dropbox.example/existing');
  assert.deepEqual(calls, ['sharing/list_shared_links']);
});

test('a PDF upload replaces the same path so its link survives', async () => {
  const provider = new DropboxProvider('test-key');
  let seen;
  provider.content = async (endpoint, arg, body) => {
    seen = { endpoint, arg, body };
    return { json: async () => ({ rev: 'r1' }) };
  };

  await provider.writePdf('/note.pdf', new Uint8Array([1, 2, 3]));
  assert.equal(seen.endpoint, 'files/upload');
  assert.equal(seen.arg.path, '/note.pdf');
  assert.equal(seen.arg.mode['.tag'], 'overwrite');
  assert.equal(seen.arg.autorename, false);
  assert.equal(seen.body.type, 'application/pdf');
});
