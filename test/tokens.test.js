import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TOKEN_AGE_DAYS,
  MAX_TOKEN_AGE_DAYS,
  tokenAge,
  tokenAgeDays,
  tokenExpired,
} from '../js/tokens.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

test('a stored sign-in lasts 180 days unless the reader chooses otherwise', () => {
  assert.equal(DEFAULT_TOKEN_AGE_DAYS, 180);
  assert.equal(tokenAgeDays(null), 180);
  assert.equal(tokenAgeDays(''), 180);
  assert.equal(tokenAgeDays('90'), 90);
  assert.equal(tokenAgeDays(30), 30);
});

test('a setting that cannot mean a positive number falls back to the default', () => {
  for (const value of ['0', '-5', '1.5', 'forever', 'never', ' ', NaN, Infinity]) {
    assert.equal(tokenAgeDays(value), DEFAULT_TOKEN_AGE_DAYS, String(value));
  }
});

test('an excessive limit is capped so a typo cannot mean "never"', () => {
  assert.equal(tokenAgeDays(String(MAX_TOKEN_AGE_DAYS + 1)), MAX_TOKEN_AGE_DAYS);
});

test('the boundary is inclusive: at exactly 180 days the sign-in is expired', () => {
  const savedAt = NOW - 180 * DAY;
  assert.equal(tokenExpired(savedAt, NOW, 180), true);
  assert.equal(tokenExpired(savedAt + 1, NOW, 180), false);
});

test('the configured number of days is what counts', () => {
  assert.equal(tokenExpired(NOW - 31 * DAY, NOW, 30), true);
  assert.equal(tokenExpired(NOW - 29 * DAY, NOW, 30), false);
  assert.equal(tokenExpired(NOW - 31 * DAY, NOW), false);
});

test('a sign-in with no readable timestamp is expired, not trusted', () => {
  for (const savedAt of [null, undefined, '', 0, -1, 'yesterday', NaN]) {
    assert.equal(tokenExpired(savedAt, NOW, 180), true, String(savedAt));
  }
  assert.equal(tokenAge(null, NOW), null);
});

test('a clock that moved backwards does not create a negative age', () => {
  assert.equal(tokenAge(NOW + DAY, NOW), 0);
  assert.equal(tokenExpired(NOW + DAY, NOW, 180), false);
});
