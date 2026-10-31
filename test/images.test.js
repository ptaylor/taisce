import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assetDirFor,
  imageExtension,
  imageFileName,
  markdownImage,
  resolveImagePath,
} from '../js/images.js';

test('image extensions come from the MIME type, with a sane fallback', () => {
  assert.equal(imageExtension('image/png'), 'png');
  assert.equal(imageExtension('image/jpeg'), 'jpg');
  assert.equal(imageExtension('IMAGE/WEBP'), 'webp');
  assert.equal(imageExtension('application/octet-stream'), 'png');
  assert.equal(imageExtension(undefined), 'png');
});

test('file names are timestamped and carry the right extension', () => {
  const name = imageFileName('image/png', Date.UTC(2026, 9, 31, 12, 4, 5));
  // Local time is used, so only assert the shape rather than the exact hour.
  assert.match(name, /^\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
  assert.equal(imageFileName('image/jpeg', Date.now()).endsWith('.jpg'), true);
});

test('a suffix keeps two pastes in the same second apart', () => {
  const now = Date.UTC(2026, 9, 31, 12, 4, 5);
  const first = imageFileName('image/png', now, 'a1b2');
  const second = imageFileName('image/png', now, 'c3d4');
  assert.notEqual(first, second);
  assert.match(first, /-a1b2\.png$/);
});

test('assets live beside the note, not at the root', () => {
  assert.equal(assetDirFor('/notes/ideas.md'), '/notes/assets');
  assert.equal(assetDirFor('/welcome.md'), '/assets');
});

test('the link is relative so any Markdown editor can follow it', () => {
  assert.equal(markdownImage('2026-10-31-120405.png'), '![](assets/2026-10-31-120405.png)');
});

test('relative image references resolve against the note, absolute URLs do not', () => {
  assert.equal(resolveImagePath('/notes/ideas.md', 'assets/a.png'), '/notes/assets/a.png');
  assert.equal(resolveImagePath('/notes/ideas.md', './assets/a.png'), '/notes/assets/a.png');
  assert.equal(resolveImagePath('/welcome.md', 'assets/a.png'), '/assets/a.png');
  assert.equal(resolveImagePath('/notes/ideas.md', '/notes/assets/a.png'), '/notes/assets/a.png');
  assert.equal(resolveImagePath('/notes/ideas.md', 'https://example.com/a.png'), null);
  assert.equal(resolveImagePath('/notes/ideas.md', 'data:image/png;base64,AAA'), null);
  assert.equal(resolveImagePath('/notes/ideas.md', ''), null);
});

test('a reference cannot walk out of the note\'s folder', () => {
  assert.equal(resolveImagePath('/notes/ideas.md', '../secret.png'), null);
  assert.equal(resolveImagePath('/notes/ideas.md', 'assets/../../secret.png'), null);
  assert.equal(resolveImagePath('/notes/ideas.md', '../../../../etc/passwd'), null);
  assert.equal(resolveImagePath('/notes/ideas.md', 'assets/./a.png'), null);
  assert.equal(resolveImagePath('/notes/ideas.md', '/notes/assets/../secret.png'), null);
  // Leading ./ is normal, not traversal.
  assert.equal(resolveImagePath('/notes/ideas.md', './assets/a.png'), '/notes/assets/a.png');
});
