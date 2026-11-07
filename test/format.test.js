// Inline formatting shortcuts: what the delimiters are, and where the caret
// and selection land afterwards. The editor only moves the textarea; all of
// the judgement is here so it can be checked without a DOM.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  closeOfFormat,
  formatSelection,
  shortcutFormat,
  startFormat,
} from '../js/format.js';

function select(source, needle, format) {
  const start = source.indexOf(needle);
  assert.notEqual(start, -1, `fixture does not contain ${needle}`);
  return formatSelection(source, start, start + needle.length, format);
}

test('the shortcut map is Cmd/Ctrl+B, I, U and Shift+X', () => {
  assert.equal(shortcutFormat({ key: 'b', metaKey: true }), 'bold');
  assert.equal(shortcutFormat({ key: 'B', ctrlKey: true }), 'bold');
  assert.equal(shortcutFormat({ key: 'i', metaKey: true }), 'italic');
  assert.equal(shortcutFormat({ key: 'u', ctrlKey: true }), 'underline');
  assert.equal(shortcutFormat({ key: 'X', metaKey: true, shiftKey: true }), 'strike');
  assert.equal(shortcutFormat({ key: 'x', ctrlKey: true, shiftKey: true }), 'strike');
});

test('a shortcut with no modifier, or with Alt, or held down, is not a format', () => {
  assert.equal(shortcutFormat({ key: 'b' }), null);
  assert.equal(shortcutFormat({ key: 'b', metaKey: true, altKey: true }), null);
  assert.equal(shortcutFormat({ key: 'b', metaKey: true, repeat: true }), null);
  assert.equal(shortcutFormat({ key: 'x', metaKey: true }), null);
  assert.equal(shortcutFormat({ key: 'i', metaKey: true, shiftKey: true }), null);
});

test('a selection is wrapped and stays selected', () => {
  const result = select('one two', 'two', 'bold');
  assert.equal(result.text, 'one **two**');
  assert.equal(result.text.slice(result.start, result.end), 'two');
});

test('pressing the same key inside the delimiters takes the format off', () => {
  const result = select('one **two**', 'two', 'bold');
  assert.equal(result.text, 'one two');
  assert.equal(result.text.slice(result.start, result.end), 'two');
});

test('selecting the delimiters too also takes the format off', () => {
  const result = select('one **two**', '**two**', 'bold');
  assert.equal(result.text, 'one two');
  assert.equal(result.text.slice(result.start, result.end), 'two');
});

test('italic on bold text nests instead of turning bold into italic', () => {
  const result = select('**two**', 'two', 'italic');
  assert.equal(result.text, '***two***');
  assert.equal(result.text.slice(result.start, result.end), 'two');
});

test('italic and bold take one or two stars off a triple marker', () => {
  const italic = select('***two***', 'two', 'italic');
  assert.equal(italic.text, '**two**');
  assert.equal(italic.text.slice(italic.start, italic.end), 'two');

  const bold = select('***two***', 'two', 'bold');
  assert.equal(bold.text, '*two*');
  assert.equal(bold.text.slice(bold.start, bold.end), 'two');
});

test('underline writes the one inline tag the sanitizer allows', () => {
  const wrapped = select('a two b', 'two', 'underline');
  assert.equal(wrapped.text, 'a <u>two</u> b');
  assert.equal(wrapped.text.slice(wrapped.start, wrapped.end), 'two');

  const removed = select('a <u>two</u> b', 'two', 'underline');
  assert.equal(removed.text, 'a two b');
  assert.equal(removed.text.slice(removed.start, removed.end), 'two');
});

test('strikethrough uses the GFM double tilde', () => {
  const wrapped = select('a two b', 'two', 'strike');
  assert.equal(wrapped.text, 'a ~~two~~ b');

  const removed = select('a ~~two~~ b', 'two', 'strike');
  assert.equal(removed.text, 'a two b');
});

test('space at the edges stays outside the delimiters', () => {
  const result = formatSelection('a  two  b', 1, 7, 'bold');
  assert.equal(result.text, 'a  **two**  b');
  assert.equal(result.text.slice(result.start, result.end), 'two');
});

test('a selection of only space is left alone', () => {
  const result = formatSelection('a   b', 1, 4, 'bold');
  assert.equal(result.text, 'a   b');
  assert.equal(result.start, 1);
  assert.equal(result.end, 4);
});

test('an unknown format changes nothing', () => {
  const result = formatSelection('a two b', 2, 5, 'sparkle');
  assert.deepEqual(result, { text: 'a two b', start: 2, end: 5 });
});

test('starting a format leaves the caret between the halves', () => {
  const bold = startFormat('abc', 1, 'bold');
  assert.equal(bold.text, 'a****bc');
  assert.equal(bold.caret, 3);
  assert.equal(closeOfFormat(bold.text, 1, 'bold'), 3);

  const underline = startFormat('abc', 1, 'underline');
  assert.equal(underline.text, 'a<u></u>bc');
  assert.equal(underline.caret, 4);
  assert.equal(closeOfFormat(underline.text, 1, 'underline'), 4);
});

test('the closing half is found after the text that was typed into it', () => {
  const started = startFormat('', 0, 'italic');
  const typed = started.text.slice(0, started.caret) + 'two' + started.text.slice(started.caret);
  assert.equal(typed, '*two*');
  assert.equal(closeOfFormat(typed, 0, 'italic'), 4);
});

test('a deleted opening half has no closing half to return', () => {
  assert.equal(closeOfFormat('ab*cd', 2, 'bold'), -1);
  assert.equal(closeOfFormat('plain text', 0, 'bold'), -1);
});
