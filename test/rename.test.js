import test from 'node:test';
import assert from 'node:assert/strict';

import { DropboxProvider } from '../js/dropbox.js';
import { createMockProvider } from '../js/mock.js';

test('renaming asks Dropbox to move the file without an automatic suffix', async () => {
  const provider = new DropboxProvider('test-key');
  let seen;
  provider.rpc = async (endpoint, arg) => {
    seen = { endpoint, arg };
    return { metadata: { path_lower: '/notes/new.md', rev: 'r7' } };
  };

  assert.deepEqual(await provider.rename('/notes/old.md', '/notes/new.md'), {
    path: '/notes/new.md',
    rev: 'r7',
  });
  assert.equal(seen.endpoint, 'files/move_v2');
  assert.deepEqual(seen.arg, {
    from_path: '/notes/old.md',
    to_path: '/notes/new.md',
    autorename: false,
  });
});

test('a shared file is recognised without creating a link', async () => {
  const provider = new DropboxProvider('test-key');
  const calls = [];
  provider.rpc = async (endpoint) => {
    calls.push(endpoint);
    return { links: [{ path_lower: '/notes/a.md', url: 'https://dropbox.example/a' }] };
  };

  assert.equal(await provider.hasSharedLink('/notes/a.md'), true);
  assert.deepEqual(calls, ['sharing/list_shared_links']);
});

test('a file Dropbox cannot find is not shared', async () => {
  const provider = new DropboxProvider('test-key');
  provider.rpc = async () => {
    throw new Error('path/not_found/...');
  };

  assert.equal(await provider.hasSharedLink('/missing.md'), false);
});

test('the demo moves a note and its shared PDF together', async () => {
  const store = new Map();
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    configurable: true,
    writable: true,
  });

  try {
    localStorage.setItem(
      'taisce.mock.v2',
      JSON.stringify({
        folders: ['/notes'],
        files: {
          '/notes/a.md': { rev: 'r1', text: '# a', modified: 0 },
          '/notes/taken.md': { rev: 'r1', text: '# taken', modified: 0 },
        },
        images: {},
        pdfs: { '/notes/a.pdf': 'data:application/pdf;base64,JVBERi0xLjQ=' },
        shared: {},
      }),
    );

    const provider = createMockProvider();
    await provider.shareLink('/notes/a.pdf');
    assert.equal(await provider.hasSharedLink('/notes/a.pdf'), true);

    assert.deepEqual(await provider.rename('/notes/a.md', '/notes/b.md'), {
      path: '/notes/b.md',
      rev: 'r1',
    });
    assert.equal((await provider.read('/notes/b.md')).text, '# a');
    await assert.rejects(provider.read('/notes/a.md'));
    await assert.rejects(provider.rename('/notes/b.md', '/notes/taken.md'), /conflict/);

    await provider.rename('/notes/a.pdf', '/notes/b.pdf');
    assert.equal(await provider.hasSharedLink('/notes/b.pdf'), true);
    assert.equal(await provider.hasSharedLink('/notes/a.pdf'), false);
    assert.equal((await provider.metadata('/notes/b.pdf')).type, 'file');
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  }
});
