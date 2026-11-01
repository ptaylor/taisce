import test from 'node:test';
import assert from 'node:assert/strict';

import { configure, isEnabled, releaseSlug, trackEvent, trackView, versionSlug } from '../js/analytics.js';

function fakeWindow() {
  const calls = [];
  const scope = { goatcounter: { count: (vars) => calls.push(vars) } };
  return { calls, scope };
}

test('a version becomes the slug the report reads', () => {
  assert.equal(versionSlug('v0.16'), 'v0-16');
  assert.equal(versionSlug(' V0.16 '), 'v0-16');
  assert.equal(versionSlug(''), '');
});

test('the release comes from the meta tag publish.sh stamps', () => {
  const document = { querySelector: () => ({ content: 'v0.16' }) };
  assert.equal(releaseSlug(document), 'v0-16');
  assert.equal(releaseSlug({ querySelector: () => null }), '');
});

test('nothing is counted when the counter is absent', () => {
  assert.doesNotThrow(() => trackView('/'));
  assert.doesNotThrow(() => trackEvent('share-copy'));
});

test('the demo can switch counting off', () => {
  const { calls, scope } = fakeWindow();
  const original = globalThis.window;
  globalThis.window = scope;
  try {
    configure({ demo: true });
    assert.equal(isEnabled(), false);
    trackView('/');
    trackEvent('share-copy');
    assert.deepEqual(calls, []);

    configure();
    trackView('/');
    trackEvent('share-copy');
    assert.deepEqual(calls, [{ path: '/' }, { path: 'share-copy', event: true }]);
  } finally {
    configure();
    globalThis.window = original;
  }
});

test('a counter that throws cannot break an edit', () => {
  const original = globalThis.window;
  globalThis.window = {
    goatcounter: {
      count: () => {
        throw new Error('blocked');
      },
    },
  };
  try {
    assert.doesNotThrow(() => trackEvent('task-toggle'));
  } finally {
    globalThis.window = original;
  }
});
