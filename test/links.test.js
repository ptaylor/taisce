import test from 'node:test';
import assert from 'node:assert/strict';

import { findLinks, editLink, removeLink, linkMarkdown, isUrl } from '../js/links.js';
import { createRenderer } from '../js/markdown.js';

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

test('a URL glued to the word before it is a link, because the renderer says so', () => {
  // marked breaks the text run before a scheme and links what follows, and an
  // editor that disagreed would leave the block's links unmatched.
  assert.deepEqual(shapes('see ahttps://example.com'), [
    { form: 'bare', text: 'https://example.com', href: 'https://example.com' },
  ]);
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

test('ftp and www are recognised the way the renderer recognises them', () => {
  assert.deepEqual(shapes('ftp://example.com/f here'), [
    { form: 'bare', text: 'ftp://example.com/f', href: 'ftp://example.com/f' },
  ]);
  assert.deepEqual(shapes('www.example.com here'), [
    { form: 'bare', text: 'www.example.com', href: 'http://www.example.com' },
  ]);
});

test('an address the renderer linkifies can be edited too', () => {
  const source = 'Mail [the team](https://example.com/team) or a.b+c@example.co.uk today.';
  const links = findLinks(source);
  assert.deepEqual(
    links.map((link) => [link.form, link.href]),
    [
      ['inline', 'https://example.com/team'],
      ['address', 'mailto:a.b+c@example.co.uk'],
    ],
  );
  assert.equal(
    editLink(source, links[1], { href: 'mailto:hello@example.com' }),
    'Mail [the team](https://example.com/team) or hello@example.com today.',
  );
  assert.equal(
    editLink(source, links[1], { text: 'email us' }),
    'Mail [the team](https://example.com/team) or [email us](mailto:a.b+c@example.co.uk) today.',
  );
  assert.equal(
    removeLink(source, links[1]),
    'Mail [the team](https://example.com/team) or a.b+c@example.co.uk today.',
  );
});

test('every link the renderer produces is one this module can find, in order', () => {
  const render = createRenderer({ sanitize: (html) => html });
  const corpus = [
    'A bare https://example.com in a sentence.',
    'foohttps://example.com/x',
    'www.example.com without a scheme',
    'ftp://example.com/file here',
    'Mail a@example.com or see https://example.com/contact',
    'a.b+c@example.co.uk',
    '- item with https://example.com/list and more',
    '- [ ] a task with https://example.com/task',
    '**bold https://example.com/bold** end',
    'Text (see https://example.com/parens) here',
    String.raw`"https://example.com/quoted" and 'https://example.com/single'`,
    'https://example.com/trailing, then words',
    'Punctuation https://example.com/dot. End',
    'Semicolon https://example.com/semi; next',
    'A https://example.com/x**bold** b',
    'A https://example.com/x_ b',
    'A https://example.com/x~ b',
    'A https://example.com/x?a=1&b=2 b',
    '## Heading with https://example.com/h',
    '> quote with https://example.com/q',
    '| a | b |\n| - | - |\n| https://example.com/cell | x |',
    '<https://auto.example>',
    'A [link](https://a.example) and https://b.example together.',
    'A [link](https://a.example) and <https://b.example> and c@d.example',
    'A [titled](https://a.example "Title") and [nested [brackets]](https://b.example)',
    'Trailing slash https://example.com/',
    'Port https://example.com:8443/x here',
    'Percent https://example.com/a%20b here',
    'Text `https://code.example` in backticks',
    'A ![](https://example.com/i.png) image',
  ];

  for (const source of corpus) {
    const rendered = [...render(source).matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => match[1]);
    const found = findLinks(source).map((link) => link.href);
    assert.deepEqual(found, rendered, source);
  }
});

test('isUrl accepts one URL and nothing else', () => {
  assert.equal(isUrl(' https://example.com/a?b=c '), true);
  assert.equal(isUrl('mailto:a@example.com'), true);
  assert.equal(isUrl('two words'), false);
  assert.equal(isUrl('https://example.com and more'), false);
});
