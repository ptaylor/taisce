import test from 'node:test';
import assert from 'node:assert/strict';

import { createSaveEngine } from '../js/save.js';
import { AuthError, ConflictError } from '../js/errors.js';

function makeProvider({ text = 'a', rev = 'r1' } = {}) {
  const writes = [];
  let state = { text, rev };
  let gate = null;
  let conflicts = 0;
  let authFailure = false;

  return {
    writes,
    get state() {
      return state;
    },
    set remote(next) {
      state = { ...next };
    },
    hold() {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      gate = { promise, release };
      return gate;
    },
    conflictOnce() {
      conflicts += 1;
    },
    failAuth() {
      authFailure = true;
    },
    async read() {
      return { ...state };
    },
    async write(path, text, rev) {
      if (gate) {
        const held = gate;
        gate = null;
        await held.promise;
      }
      writes.push({ path, text, rev });
      if (authFailure) throw new AuthError('session expired');
      if (conflicts > 0) {
        conflicts -= 1;
        throw new ConflictError('conflict');
      }
      if (rev && rev !== state.rev) throw new ConflictError('conflict');
      state = { text, rev: `r${Number(state.rev.slice(1)) + 1}` };
      return { rev: state.rev };
    },
  };
}

function makeEngine({ provider, edits = () => [] }) {
  const statuses = [];
  const remotes = [];
  let authLost = 0;
  const engine = createSaveEngine({
    provider,
    onStatus: (kind, detail) => statuses.push([kind, detail]),
    onRemote: (text, info) => remotes.push({ text, ...info }),
    onAuthLost: () => {
      authLost += 1;
    },
    getEdits: edits,
  });
  return { engine, statuses, remotes, authLost: () => authLost };
}

test('saves the changed text and reports it saved', async () => {
  const provider = makeProvider({ text: 'a' });
  const { engine, statuses } = makeEngine({ provider });

  engine.open({ path: '/n.md', text: 'a', rev: 'r1' });
  engine.setText('b');
  await engine.save();

  assert.equal(provider.writes.length, 1);
  assert.equal(provider.writes[0].text, 'b');
  assert.equal(provider.writes[0].rev, 'r1');
  assert.equal(provider.state.text, 'b');
  assert.equal(engine.isDirty(), false);
  assert.deepEqual(statuses.at(-1)[0], 'saved');
});

test('does not touch Dropbox when nothing changed', async () => {
  const provider = makeProvider();
  const { engine } = makeEngine({ provider });

  engine.open({ path: '/n.md', text: 'a', rev: 'r1' });
  await engine.save();

  assert.equal(provider.writes.length, 0);
});

test('an edit made during an upload is not lost', async () => {
  const provider = makeProvider({ text: 'a' });
  const { engine } = makeEngine({ provider });

  engine.open({ path: '/n.md', text: 'a', rev: 'r1' });
  const gate = provider.hold();
  engine.setText('b');
  const saving = engine.save();

  await new Promise((resolve) => setTimeout(resolve, 0));
  engine.setText('c');
  gate.release();
  await saving;

  assert.equal(provider.state.text, 'c');
  assert.deepEqual(provider.writes.map((write) => write.text), ['b', 'c']);
});

test('a conflict re-applies the locally edited block onto the remote copy', async () => {
  const provider = makeProvider({ text: 'A\n\nB' });
  const { engine, remotes } = makeEngine({
    provider,
    edits: () => [{ index: 0, source: 'A local', type: 'paragraph' }],
  });

  engine.open({ path: '/n.md', text: 'A\n\nB', rev: 'r1' });
  provider.remote = { text: 'A\n\nB remote', rev: 'r9' };
  provider.conflictOnce();
  engine.setText('A local\n\nB');
  await engine.save();

  assert.equal(provider.state.text, 'A local\n\nB remote');
  assert.equal(remotes.length, 1);
  assert.equal(remotes[0].dropped, false);
});

test('a conflict with a changed structure keeps the remote copy and says so', async () => {
  const provider = makeProvider({ text: 'A\n\nB' });
  const { engine, remotes } = makeEngine({ provider });

  engine.open({ path: '/n.md', text: 'A\n\nB', rev: 'r1' });
  provider.remote = { text: 'A only', rev: 'r9' };
  provider.conflictOnce();
  engine.setText('A local\n\nB');
  await engine.save();

  assert.equal(provider.state.text, 'A only');
  assert.equal(remotes.length, 1);
  assert.equal(remotes[0].dropped, true);
  assert.equal(engine.text(), 'A only');
});

test('an expired session stops saving and tells the app', async () => {
  const provider = makeProvider();
  provider.failAuth();
  const { engine, statuses, authLost } = makeEngine({ provider });

  engine.open({ path: '/n.md', text: 'a', rev: 'r1' });
  engine.setText('b');
  await engine.save();

  assert.equal(authLost(), 1);
  assert.equal(statuses.at(-1)[0], 'error');
  assert.equal(engine.isDirty(), true);
});
