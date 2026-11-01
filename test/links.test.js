import test from 'node:test';
import assert from 'node:assert/strict';

import { findLinks, editLink, removeLink, linkMarkdown, isUrl } from '../js/links.js';

const shapes = (source) =>
  findLinks(source).map((link) => ({ form: link.form, text: link.text, href: link.href }));

test('a link inside a sentence is found', () => {
  const source = 'Read the [guide](https://example.com/guide) before you start.';
  const [link] = findLinks(source);
  assert.equal(link.text, 'guide');
  assert.equal(link.href, 'https://example.com/guide');
  assert.equal(source.slice(link.start, link.end), '[guide](https://example.com/guide)');
});

test('links in list items, headings and quotes are found', () => {
  const source = [
    '## See [one](https://a.example)',
    '',
    '- [two](https://b.example) and more',
    '- item',
    '',
    '> [three](https://c.example)',
  ].join('\n');
  assert.deepEqual(
    shapes(source).map((link) => link.href),
    ['https://a.example', 'https://b.example', 'https://c.example'],
  );
});

test('images are not links', () => {
  assert.deepEqual(shapes('![alt](https://example.com/a.png)'), []);
  assert.equal(findLinks('![alt](https://example.com/a.png) then [x](u)').length, 1);
});

test('code spans and escaped brackets are skipped', () => {
  assert.deepEqual(shapes('`[not](https://example.com)`'), []);
  assert.deepEqual(shapes('`https://example.com`'), []);
  // The escaped bracket is literal text, so the parenthesised URL is merely a
  // bare URL — not an inline link with a label to edit.
  assert.deepEqual(shapes('\\[not](https://e.example)').map((link) => link.form), ['bare']);
  assert.equal(findLinks('``a ` b`` [yes](https://e.example)').length, 1);
});

test('autolinks and bare URLs count, with trailing punctuation left out', () => {
  assert.deepEqual(shapes('<https://example.com>'), [
    { form: 'autolink', text: 'https://example.com', href: 'https://example.com' },
  ]);
  const [bare, other] = findLinks('Go to https://example.com/a, or see https://example.org/b.');
  assert.equal(bare.form, 'bare');
  assert.equal(bare.href, 'https://example.com/a');
  assert.equal(other.href, 'https://example.org/b');
});

test('a URL in the middle of a word is not a link', () => {
  assert.deepEqual(shapes('see ahttps://example.com'), []);
});

test('editing the address leaves the rest of the block byte-identical', () => {
  const source = 'Text [guide](https://old.example/path) and **more** here.';
  const [link] = findLinks(source);
  const next = editLink(source, link, { text: 'guide', href: 'https://new.example/other' });
  assert.equal(next, 'Text [guide](https://new.example/other) and **more** here.');
});

test('editing the text keeps the destination and any title', () => {
  const source = 'A [guide](https://example.com "Title") here.';
  const [link] = findLinks(source);
  assert.equal(
    editLink(source, link, { text: 'handbook', href: link.href }),
    'A [handbook](https://example.com "Title") here.',
  );
});

test('destinations with brackets or spaces are wrapped in angle brackets', () => {
  assert.equal(linkMarkdown('a b', 'https://example.com/a b'), '[a b](<https://example.com/a b>)');
  assert.equal(linkMarkdown('x', 'https://example.com'), '[x](https://example.com)');
  assert.equal(linkMarkdown('a[b]c', 'https://e.example'), '[a\\[b\\]c](https://e.example)');
});

test('retargeting an autolink keeps its shape', () => {
  const source = 'See <https://old.example> now.';
  const [link] = findLinks(source);
  assert.equal(
    editLink(source, link, { href: 'https://new.example' }),
    'See <https://new.example> now.',
  );
  assert.equal(editLink(source, link, { text: 'the docs' }), 'See [the docs](https://old.example) now.');
});

test('removing a link keeps the words that were linked', () => {
  const source = 'Read the [**guide**](https://example.com) now.';
  const [link] = findLinks(source);
  assert.equal(removeLink(source, link), 'Read the **guide** now.');
  assert.equal(
    removeLink('<https://example.com>', findLinks('<https://example.com>')[0]),
    'https://example.com',
  );
});

test('an edit leaves the neighbouring list items alone', () => {
  const source = '- [x] [one](https://a.example)\n- [ ] two\n';
  const [link] = findLinks(source);
  assert.equal(
    editLink(source, link, { href: 'https://b.example' }),
    '- [x] [one](https://b.example)\n- [ ] two\n',
  );
});

test('isUrl accepts one URL and nothing else', () => {
  assert.equal(isUrl(' https://example.com/a?b=c '), true);
  assert.equal(isUrl('mailto:a@example.com'), true);
  assert.equal(isUrl('two words'), false);
  assert.equal(isUrl('https://example.com and more'), false);
});
