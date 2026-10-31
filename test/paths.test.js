import test from 'node:test';
import assert from 'node:assert/strict';

import { baseName, breadcrumbs, joinPath, normaliseDir, parentDir } from '../js/paths.js';

test('normaliseDir is the canonical Dropbox shape: leading slash, no trailing slash', () => {
  assert.equal(normaliseDir(''), '');
  assert.equal(normaliseDir('/'), '');
  assert.equal(normaliseDir('notes'), '/notes');
  assert.equal(normaliseDir('/notes/'), '/notes');
  assert.equal(normaliseDir('/notes/2026//'), '/notes/2026');
});

test('parentDir walks up one level and stops at the root', () => {
  assert.equal(parentDir(''), '');
  assert.equal(parentDir('/notes'), '');
  assert.equal(parentDir('/notes/2026'), '/notes');
  assert.equal(parentDir('/a/b/c/'), '/a/b');
});

test('joinPath handles the root and strips a pasted leading slash', () => {
  assert.equal(joinPath('', 'todo.md'), '/todo.md');
  assert.equal(joinPath('/notes', 'todo.md'), '/notes/todo.md');
  assert.equal(joinPath('/notes/', '/todo.md'), '/notes/todo.md');
});

test('baseName is the last segment, for a file or a folder', () => {
  assert.equal(baseName('/notes/2026/october.md'), 'october.md');
  assert.equal(baseName('/notes'), 'notes');
  assert.equal(baseName(''), '');
});

test('breadcrumbs start at the root and reach the current folder', () => {
  assert.deepEqual(breadcrumbs(''), [{ label: 'Taisce', path: '' }]);
  assert.deepEqual(breadcrumbs('/notes/2026'), [
    { label: 'Taisce', path: '' },
    { label: 'notes', path: '/notes' },
    { label: '2026', path: '/notes/2026' },
  ]);
});
