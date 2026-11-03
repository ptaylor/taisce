import test from 'node:test';
import assert from 'node:assert/strict';

import { backupPath, createBackupWriter } from '../js/backup.js';

// A provider just real enough to order the calls and notice overlapping writes.
function provider({ files = {} } = {}) {
  const entries = new Map(
    Object.entries(files).map(([path, text]) => [path, { type: 'file', text }]),
  );
  const calls = [];
  let active = 0;
  let mostActive = 0;

  const enter = (name, path) => {
    calls.push([name, path]);
    active += 1;
    mostActive = Math.max(mostActive, active);
  };
  const leave = () => {
    active -= 1;
  };

  return {
    calls,
    entries,
    get mostActive() {
      return mostActive;
    },
    async metadata(path) {
      enter('metadata', path);
      await Promise.resolve();
      leave();
      const entry = entries.get(path);
      if (!entry) throw new Error('path_lookup/not_found/..');
      return { type: entry.type };
    },
    async remove(path) {
      enter('remove', path);
      await Promise.resolve();
      leave();
      entries.delete(path);
    },
    async create(path, text) {
      enter('create', path);
      await Promise.resolve();
      leave();
      entries.set(path, { type: 'file', text });
    },
  };
}

test('a backup is the note path with .bak appended', () => {
  assert.equal(backupPath('notes/todo.md'), 'notes/todo.md.bak');
});

test('a missing backup is created without a delete', async () => {
  const fake = provider();
  const backup = createBackupWriter(fake);

  await backup('notes/todo.md', '# Todo\n');

  assert.deepEqual(fake.calls, [
    ['metadata', 'notes/todo.md.bak'],
    ['create', 'notes/todo.md.bak'],
  ]);
  assert.equal(fake.entries.get('notes/todo.md.bak').text, '# Todo\n');
});

test('an existing backup is deleted before the new one is written', async () => {
  const fake = provider({ files: { 'notes/todo.md.bak': 'old' } });
  const backup = createBackupWriter(fake);

  await backup('notes/todo.md', 'new');

  assert.deepEqual(
    fake.calls.map(([name]) => name),
    ['metadata', 'remove', 'create'],
  );
  assert.equal(fake.entries.get('notes/todo.md.bak').text, 'new');
});

test('a folder at the backup path is left alone and reported', async () => {
  const fake = provider();
  fake.entries.set('notes/todo.md.bak', { type: 'folder' });
  const warnings = [];
  const backup = createBackupWriter(fake, { warn: (...args) => warnings.push(args) });

  await backup('notes/todo.md', 'new');

  assert.deepEqual(
    fake.calls.map(([name]) => name),
    ['metadata'],
  );
  assert.equal(fake.entries.get('notes/todo.md.bak').type, 'folder');
  assert.equal(warnings.length, 1);
});

test('an empty note is not backed up', async () => {
  const fake = provider();
  const backup = createBackupWriter(fake);

  await backup('notes/todo.md', '');

  assert.deepEqual(fake.calls, []);
});

test('writes to one path are serialised and the last open wins', async () => {
  const fake = provider();
  const backup = createBackupWriter(fake);

  const first = backup('notes/todo.md', 'one');
  const second = backup('notes/todo.md', 'two');
  await Promise.all([first, second]);

  assert.equal(fake.mostActive, 1);
  assert.deepEqual(
    fake.calls.map(([name]) => name),
    ['metadata', 'create', 'metadata', 'remove', 'create'],
  );
  assert.equal(fake.entries.get('notes/todo.md.bak').text, 'two');
});

test('a failed backup is reported, does not reject, and does not block the next', async () => {
  const fake = provider();
  const warnings = [];
  const backup = createBackupWriter(fake, { warn: (...args) => warnings.push(args) });
  const create = fake.create;
  fake.create = async () => {
    throw new Error('network');
  };

  await backup('notes/todo.md', 'one');
  assert.equal(warnings.length, 1);

  fake.create = create;
  await backup('notes/todo.md', 'two');
  assert.equal(fake.entries.get('notes/todo.md.bak').text, 'two');
});
