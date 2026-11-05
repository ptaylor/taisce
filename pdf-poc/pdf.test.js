import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTaiscePdf,
  markdownToPdf,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  pdfPathFor,
  pdfString,
} from '../js/pdf.js';

function source(bytes) {
  return new TextDecoder('latin1').decode(bytes);
}

function pdf(markdown, options) {
  return source(markdownToPdf(markdown, options));
}

test('writes a valid-looking PDF envelope', () => {
  const output = pdf('# Hello world\n\nThis is a test.', { title: 'A note' });
  assert.ok(output.startsWith('%PDF-1.4\n'));
  assert.ok(output.endsWith('%%EOF\n'));
  assert.match(output, /\/Type \/Catalog/);
  assert.match(output, /\/Type \/Pages/);
  assert.match(output, /\/Type \/Page\b/);
  assert.match(output, /\/BaseFont \/Helvetica\b/);
  assert.match(output, /\/Title \(A note\)/);
  assert.match(output, /\(Hello world\) Tj/);
  assert.match(output, /\(This is a test\.\) Tj/);
  assert.ok(output.includes(`${PAGE_WIDTH} ${PAGE_HEIGHT}`));
});

test('refers to font resources with names, not bare operators', () => {
  const output = pdf('# Hi\n\nThere.');
  assert.match(output, /\/F2 [\d.]+ Tf/);
  assert.match(output, /\/F1 [\d.]+ Tf/);
  assert.doesNotMatch(output, /BT[^\n]*[^/]F[1-5] [\d.]+ Tf/);
});

test('keeps the output ASCII by escaping WinAnsi bytes', () => {
  const output = pdf('Café — “quoted”');
  assert.ok([...output].every((character) => character.codePointAt(0) <= 0x7e));
  assert.match(output, /Caf\\351/);
  assert.match(output, /\\227/);
  assert.match(output, /\\223quoted\\224/);
});

test('escapes parentheses and backslashes in metadata', () => {
  assert.equal(pdfString('A (B) \\ C'), 'A \\(B\\) \\\\ C');
});

test('turns http links into link annotations', () => {
  const output = pdf('[Taisce](https://example.com/a?b=c)');
  assert.match(output, /\/Subtype \/Link/);
  assert.match(output, /\/URI \(https:\/\/example\.com\/a\?b=c\)/);
});

test('does not annotate a javascript: link', () => {
  const output = pdf('[click](javascript:alert(1))');
  assert.doesNotMatch(output, /\/Subtype \/Link/);
});

test('wraps long paragraphs and long words', () => {
  const paragraph = `${'word '.repeat(150)}${'x'.repeat(180)}`;
  const output = pdf(paragraph);
  const textRuns = output.match(/\([^)]*\) Tj/g) || [];
  assert.ok(textRuns.length > 2, `expected wrapped runs, got ${textRuns.length}`);
});

test('starts a second page when the text runs past one page', () => {
  const output = pdf(Array.from({ length: 120 }, (_, index) => `Paragraph ${index}.`).join('\n\n'));
  assert.match(output, /\/Count 2\d*|\/Count [2-9]/);
});

test('renders lists, code, tables and images as text', () => {
  const output = pdf(
    [
      '- one',
      '- [x] two',
      '',
      '> quoted',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '![alt text](picture.png)',
    ].join('\n'),
  );
  assert.match(output, /\(one\) Tj/);
  assert.match(output, /\(\[x\]\) Tj/);
  assert.match(output, /\(quoted\) Tj/);
  assert.match(output, /\(const x = 1;\) Tj/);
  assert.match(output, /\(A \| B\) Tj/);
  assert.match(output, /\(1 \| 2\) Tj/);
  assert.match(output, /\(alt text\) Tj/);
});

test('keeps code indentation and repeated spaces', () => {
  const output = pdf('```\ndef outer():\n    return 1  # two\n```');
  assert.match(output, /\(    return 1  # two\) Tj/);
});

test('renders table cell Markdown instead of its source', () => {
  const output = pdf(
    '| **Name** | [site](https://x.test) |\n| - | - |\n| `a  b` | plain |',
  );
  assert.match(output, /\(Name \| \) Tj/);
  assert.match(output, /\(site\) Tj/);
  assert.match(output, /\/URI \(https:\/\/x\.test\)/);
  assert.match(output, /\(a  b\) Tj/);
  assert.doesNotMatch(output, /\*\*Name\*\*/);
  assert.doesNotMatch(output, /\[site\]/);
});

test('identifies its own PDFs by Producer metadata', () => {
  const output = pdf('# hi');
  assert.match(output, /\/Producer \(Taisce\)/);
  assert.doesNotMatch(output, /PDF POC/);
  assert.equal(isTaiscePdf(markdownToPdf('# hi')), true);
  assert.equal(isTaiscePdf(new TextEncoder().encode('%PDF-1.4\nnot ours')), false);
  assert.equal(isTaiscePdf(new Uint8Array()), false);
});

test('is deterministic and handles an empty file', () => {
  const first = markdownToPdf('', { title: 'Empty' });
  const second = markdownToPdf('', { title: 'Empty' });
  assert.deepEqual(first, second);
  assert.match(source(first), /\/Count 1/);
  assert.match(source(first), /\(Page 1 of 1\) Tj/);
});

test('names the PDF beside its note', () => {
  assert.equal(pdfPathFor('/notes/Shopping.md'), '/notes/Shopping.pdf');
  assert.equal(pdfPathFor('/Notes/Shopping.MD'), '/Notes/Shopping.pdf');
  assert.equal(pdfPathFor('/notes/plain'), '/notes/plain.pdf');
});
