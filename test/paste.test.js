import test from 'node:test';
import assert from 'node:assert/strict';

import { quotePaste } from '../js/paste.js';

test('every pasted line after the first keeps the quote marker', () => {
  const value = '> first line';
  assert.equal(quotePaste(value, value.length, 'one\ntwo'), 'one\n> two');
});

test('a selected marker is put back on the first pasted line', () => {
  assert.equal(quotePaste('> first line', 0, 'one\ntwo'), '> one\n> two');
});

test('blank pasted lines stay inside the quote', () => {
  assert.equal(quotePaste('> first', 7, 'one\n\ntwo'), 'one\n> \n> two');
});

test('Windows and old Mac line endings become the textarea newline', () => {
  assert.equal(quotePaste('> first', 7, 'one\r\n\r\ntwo'), 'one\n> \n> two');
  assert.equal(quotePaste('> first', 7, 'one\rtwo'), 'one\n> two');
});

test('a trailing newline leaves the caret on a quoted line', () => {
  assert.equal(quotePaste('> first', 7, 'one\ntwo\n'), 'one\n> two\n> ');
});

test('nested quotes keep their whole marker', () => {
  const value = '  > > first';
  assert.equal(quotePaste(value, value.length, 'one\ntwo'), 'one\n  > > two');
});

test('a single-line paste needs no help', () => {
  assert.equal(quotePaste('> first', 7, 'one'), null);
});

test('a line that is not quoted is left to the browser', () => {
  assert.equal(quotePaste('plain text', 10, 'one\ntwo'), null);
  assert.equal(quotePaste('# heading', 9, 'one\ntwo'), null);
});
