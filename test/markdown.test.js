import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderer } from '../js/markdown.js';

const render = createRenderer({ sanitize: (html) => html });

test('renders the features the requirements list', () => {
  const html = render(
    [
      '# Heading',
      '',
      '**bold** *italic* ~~struck~~ `code`',
      '',
      '- bullet',
      '- [ ] task',
      '- [x] done task',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '[link](https://example.com)',
    ].join('\n'),
  );

  assert.match(html, /<h1[^>]*>Heading<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<del>struck<\/del>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<li>bullet<\/li>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /href="https:\/\/example\.com"/);
});

test('a task list marks the ticked item checked and nothing else', () => {
  const html = render('- [ ] first\n- [x] second');
  const boxes = html.match(/<input[^>]*>/g) ?? [];

  assert.equal(boxes.length, 2);
  assert.doesNotMatch(boxes[0], /checked/);
  assert.match(boxes[1], /checked/);
});

test('everything is passed through the sanitiser', () => {
  let seen = '';
  const sanitised = createRenderer({
    sanitize: (html) => {
      seen = html;
      return '<!-- cleaned -->';
    },
  });

  assert.equal(sanitised('# Title'), '<!-- cleaned -->');
  assert.match(seen, /<h1[^>]*>Title<\/h1>/);
});
