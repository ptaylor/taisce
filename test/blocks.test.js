import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyBlockEdit,
  applyBlockEdits,
  parseBlocks,
  setTaskChecked,
  taskStates,
} from '../js/blocks.js';

const DOC = [
  '# Title',
  '',
  'A paragraph',
  'with two lines.',
  '',
  '- [ ] one',
  '- [x] two',
  '',
  '```js',
  'const a = 1;',
  '',
  'const b = 2;',
  '```',
  '',
  '> quote',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '---',
].join('\n');

test('parses each block type with its exact source', () => {
  const blocks = parseBlocks(DOC);
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['heading', 'paragraph', 'list', 'code', 'quote', 'table', 'rule'],
  );
  assert.equal(blocks[1].source, 'A paragraph\nwith two lines.');
  assert.equal(blocks[2].source, '- [ ] one\n- [x] two');
  assert.equal(blocks[3].source, '```js\nconst a = 1;\n\nconst b = 2;\n```');
});

test('every block round-trips: replacing it with its own source changes nothing', () => {
  for (const block of parseBlocks(DOC)) {
    assert.equal(applyBlockEdit(DOC, block, block.source), DOC);
  }
});

test('a block edit leaves every other byte alone', () => {
  const blocks = parseBlocks(DOC);
  const edited = applyBlockEdit(DOC, blocks[0], '## Renamed');
  assert.equal(edited, DOC.replace('# Title', '## Renamed'));
});

test('a document without a trailing newline still round-trips', () => {
  const doc = '# Title\n\n- [ ] one';
  const blocks = parseBlocks(doc);
  for (const block of blocks) assert.equal(applyBlockEdit(doc, block, block.source), doc);
  assert.equal(blocks.at(-1).end, doc.length);
});

test('an empty document has no blocks', () => {
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks('\n\n'), []);
});

test('task states point at the marker inside the line', () => {
  const list = parseBlocks(DOC).find((block) => block.type === 'list');
  const states = taskStates(list);
  assert.deepEqual(states.map((state) => state.checked), [false, true]);
  assert.equal(list.source[states[0].index], ' ');
  assert.equal(list.source[states[1].index], 'x');
});

test('toggling a task flips exactly one character', () => {
  const list = parseBlocks(DOC).find((block) => block.type === 'list');
  const checked = setTaskChecked(DOC, list, 0, true);

  assert.equal(checked.length, DOC.length);
  const differences = [...DOC].filter((char, i) => char !== checked[i]);
  assert.deepEqual(differences, [' ']);
  assert.match(checked, /^- \[x\] one$/m);
  assert.match(checked, /^- \[x\] two$/m);
});

test('toggling to the state it already has, or a missing item, changes nothing', () => {
  const list = parseBlocks(DOC).find((block) => block.type === 'list');
  assert.equal(setTaskChecked(DOC, list, 1, true), DOC);
  assert.equal(setTaskChecked(DOC, list, 9, true), DOC);
});

test('merging re-applies only the edited blocks', () => {
  const remote = DOC.replace('A paragraph', 'A paragraph (changed elsewhere)');
  const blocks = parseBlocks(remote);
  const merged = applyBlockEdits(remote, [
    { index: 2, source: '- [ ] one\n- [ ] two', type: 'list' },
  ]);

  assert.equal(merged, remote.replace('- [x] two', '- [ ] two'));
  assert.equal(blocks.length, parseBlocks(merged).length);
});

test('merging is refused when the structure changed underneath', () => {
  const remote = DOC.replace('\n\n> quote', '');
  assert.equal(applyBlockEdits(remote, [{ index: 6, source: '---', type: 'rule' }]), null);
  assert.equal(applyBlockEdits(remote, [{ index: 0, source: 'x', type: 'list' }]), null);
});
