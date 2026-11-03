import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assetDirFor,
  attachedImages,
  findImageRefs,
  removeImageRef,
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

test('assets live beside the note, not at the root, in a folder kept out of the list', () => {
  assert.equal(assetDirFor('/notes/ideas.md'), '/notes/_assets');
  assert.equal(assetDirFor('/welcome.md'), '/_assets');
});

test('the link is relative so any Markdown editor can follow it', () => {
  assert.equal(markdownImage('2026-10-31-120405.png'), '![](_assets/2026-10-31-120405.png)');
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

test('a note carries the pictures it links to, and only those', () => {
  const note = '/notes/todo.md';
  const text = [
    '# Shop',
    '![](assets/2026-11-02-120000-ab12.png)',
    'Some text, then ![](assets/2026-11-02-120100-cd34.jpg).',
    'The same picture again: ![](assets/2026-11-02-120000-ab12.png)',
    'A remote one is not in Dropbox: ![remote](https://example.com/x.png)',
    'And this one escapes: ![](../elsewhere/y.png)',
  ].join('\n');

  assert.deepEqual(attachedImages(note, text), [
    '/notes/assets/2026-11-02-120000-ab12.png',
    '/notes/assets/2026-11-02-120100-cd34.jpg',
  ]);
});

test('raw HTML images count too, because the renderer hydrates them', () => {
  assert.deepEqual(attachedImages('/a.md', '<img src="assets/p.png" alt="p">'), ['/assets/p.png']);
  assert.deepEqual(attachedImages("/a.md", "<img src='assets/q.gif'>"), ['/assets/q.gif']);
});

test('a note never counts itself, and plain text counts nothing', () => {
  assert.deepEqual(attachedImages('/a.md', 'no pictures at all'), []);
  assert.deepEqual(attachedImages('/a.md', '![](a.md)'), []);
});

test('a picture reference knows its own span, so the markup can be removed', () => {
  const source = 'Before ![](assets/a.png) and <img src="assets/b.gif"> after.';
  const refs = findImageRefs(source);
  assert.deepEqual(refs.map((ref) => ref.src), ['assets/a.png', 'assets/b.gif']);
  for (const ref of refs) {
    assert.equal(source.slice(ref.start, ref.end).includes(ref.src), true);
  }
  assert.equal(removeImageRef(source, refs[0]), 'Before  and <img src="assets/b.gif"> after.');
  assert.equal(removeImageRef(source, refs[1]), 'Before ![](assets/a.png) and  after.');
});

test('a titled picture reference is removed whole', () => {
  const source = 'Text ![](assets/a.png "A caption") more';
  const [ref] = findImageRefs(source);
  assert.equal(ref.src, 'assets/a.png');
  assert.equal(removeImageRef(source, ref), 'Text  more');
});
