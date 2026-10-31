import test from 'node:test';
import assert from 'node:assert/strict';

import { createHistory } from '../js/history.js';

const op = (before, after, start = 0) => ({ start, before, after });

test('undo and redo walk the recorded operations in order', () => {
  const history = createHistory(10);
  history.record(op('a', 'b', 0));
  history.record(op('b', 'c', 0));

  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);

  assert.equal(history.undo().before, 'b');
  assert.equal(history.undo().before, 'a');
  assert.equal(history.undo(), null);
  assert.equal(history.canUndo(), false);

  assert.equal(history.redo().after, 'b');
  assert.equal(history.redo().after, 'c');
  assert.equal(history.redo(), null);
});

test('recording after an undo drops the redo branch', () => {
  const history = createHistory(10);
  history.record(op('a', 'b'));
  history.undo();
  history.record(op('a', 'z'));

  assert.equal(history.canRedo(), false);
  assert.equal(history.undo().after, 'z');
});

test('the limit drops the oldest entries, and follows a later limit', () => {
  const history = createHistory(2);
  history.record(op('a', 'b'));
  history.record(op('b', 'c'));
  history.record(op('c', 'd'));
  assert.equal(history.undoDepth(), 2);

  history.setLimit(1);
  assert.equal(history.undoDepth(), 1);
  assert.equal(history.undo().after, 'd');
});

test('an edit that changes nothing is not recorded', () => {
  const history = createHistory(5);
  history.record(op('same', 'same'));
  assert.equal(history.canUndo(), false);
});

test('clear empties both stacks', () => {
  const history = createHistory(5);
  history.record(op('a', 'b'));
  history.undo();
  history.clear();
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
});
