import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HIDDEN_PREFIX,
  isHiddenName,
  isHiddenPath, baseName, breadcrumbs, joinPath, normaliseDir, parentDir,
  renamedPath } from '../js/paths.js';

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

test('a rename keeps the note in its folder and accepts an .md extension or not', () => {
  assert.equal(renamedPath('/notes/Shopping.md', 'Food'), '/notes/Food.md');
  assert.equal(renamedPath('/notes/Shopping.md', 'Food.md'), '/notes/Food.md');
  assert.equal(renamedPath('/notes/Shopping.MD', 'Food.MD'), '/notes/Food.MD');
  assert.equal(renamedPath('/notes/Shopping.md', '  Food  '), '/notes/Food.md');
  assert.equal(renamedPath('/Shopping.md', 'Food'), '/Food.md');
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

test('a leading underscore means "not a note"', () => {
  assert.equal(HIDDEN_PREFIX, '_');
  assert.equal(isHiddenName('_assets'), true);
  assert.equal(isHiddenName('_draft.md'), true);
  assert.equal(isHiddenName('assets'), false);
  assert.equal(isHiddenName('my_assets'), false);
  assert.equal(isHiddenName(''), false);
});

test('a path is hidden when any part of it is', () => {
  assert.equal(isHiddenPath('/notes/_assets/a.png'), true);
  assert.equal(isHiddenPath('/_private/plan.md'), true);
  assert.equal(isHiddenPath('/notes/_draft.md'), true);
  assert.equal(isHiddenPath('/notes/_assets'), true, 'the folder itself');
  assert.equal(isHiddenPath('/notes/plan.md'), false);
  assert.equal(isHiddenPath('/notes/my_assets/a.png'), false);
  assert.equal(isHiddenPath(''), false);
  assert.equal(isHiddenPath('/'), false);
});
