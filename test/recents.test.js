import test from 'node:test';
import assert from 'node:assert/strict';

import { folderOf, recentCount, recentFiles, searchFiles, RECENT_DEFAULT } from '../js/recents.js';

const FILES = [
  { name: 'shopping', path: '/shopping.md', modified: 1000 },
  { name: 'october', path: '/notes/2026/october.md', modified: 3000 },
  { name: 'ideas', path: '/notes/ideas.md', modified: 2000 },
];

test('recent files are newest first and capped', () => {
  assert.deepEqual(
    recentFiles(FILES, 2).map((file) => file.name),
    ['october', 'ideas'],
  );
  assert.equal(recentFiles(FILES, 99).length, 3);
});

test('files without a modification time sort last but keep a stable order', () => {
  const files = [
    { name: 'b', path: '/b.md' },
    { name: 'a', path: '/a.md' },
    { name: 'new', path: '/new.md', modified: 5 },
  ];
  assert.deepEqual(
    recentFiles(files, 3).map((file) => file.name),
    ['new', 'a', 'b'],
  );
});

test('search matches the name only, case-insensitively, never the folder', () => {
  assert.deepEqual(
    searchFiles(FILES, 'IDEA').map((file) => file.path),
    ['/notes/ideas.md'],
  );
  assert.deepEqual(searchFiles(FILES, 'notes'), []);
  assert.deepEqual(searchFiles(FILES, '   '), []);
});

test('search results are ordered by name, not by folder', () => {
  const files = [
    { name: 'zeta', path: '/a/zeta.md' },
    { name: 'alpha', path: '/b/alpha.md' },
  ];
  assert.deepEqual(
    searchFiles(files, 'a').map((file) => file.name),
    ['alpha', 'zeta'],
  );
});

test('the recent count preference is clamped to something sane', () => {
  assert.equal(recentCount('7'), 7);
  assert.equal(recentCount('0'), 1);
  assert.equal(recentCount('999'), 20);
  assert.equal(recentCount('nonsense'), RECENT_DEFAULT);
  assert.equal(recentCount(undefined), RECENT_DEFAULT);
});

test('folderOf names the folder a result lives in', () => {
  assert.equal(folderOf('/notes/2026/october.md'), '/notes/2026');
  assert.equal(folderOf('/welcome.md'), '/');
});
