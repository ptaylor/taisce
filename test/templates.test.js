import test from 'node:test';
import assert from 'node:assert/strict';

import { TEMPLATES, detectSlash, expandTemplate, matchTemplates } from '../js/templates.js';

test('a slash at the start of an empty line opens the menu', () => {
  assert.deepEqual(detectSlash('/'), { start: 0, end: 1, query: '' });
  assert.deepEqual(detectSlash('/tas'), { start: 0, end: 4, query: 'tas' });
  assert.deepEqual(detectSlash('first line\n/co'), { start: 11, end: 14, query: 'co' });
});

test('slashes inside text never open the menu', () => {
  assert.equal(detectSlash('and/or'), null);
  assert.equal(detectSlash('see /task'), null);
  assert.equal(detectSlash('/usr/bin'), null, 'only one query segment is allowed');
  assert.equal(detectSlash('2026/11/01'), null);
  assert.equal(detectSlash('/task and more'), null, 'queries are one word');
});

test('the menu closes when the caret is not at the end of the line', () => {
  assert.equal(detectSlash('/tas rest', 4), null);
  assert.equal(detectSlash('/tas', 2), null, 'text after the caret keeps it closed');
  assert.equal(detectSlash('/tas')?.query, 'tas');
});

test('matching is by label, keyword or id, prefix first', () => {
  assert.equal(matchTemplates('').length, TEMPLATES.length);
  assert.deepEqual(matchTemplates('task').map((t) => t.id), ['task']);
  assert.deepEqual(matchTemplates('todo').map((t) => t.id), ['task']);
  assert.deepEqual(matchTemplates('code').map((t) => t.id)[0], 'code');
  assert.deepEqual(matchTemplates('list').map((t) => t.id), ['task', 'bullet', 'number']);
  assert.deepEqual(matchTemplates('zzz'), []);
});

test('expanding a template strips the caret marker and reports its offset', () => {
  const task = expandTemplate(TEMPLATES.find((t) => t.id === 'task'));
  assert.deepEqual(task, { text: '- [ ] ', caret: 6 });

  const code = expandTemplate(TEMPLATES.find((t) => t.id === 'code'));
  assert.equal(code.text, '```\n\n```');
  assert.equal(code.caret, 4);

  const link = expandTemplate(TEMPLATES.find((t) => t.id === 'link'));
  assert.deepEqual(link, { text: '[](url)', caret: 1 });

  const rule = expandTemplate(TEMPLATES.find((t) => t.id === 'rule'));
  assert.deepEqual(rule, { text: '---', caret: 3 });
});
