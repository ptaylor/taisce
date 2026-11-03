import test from 'node:test';
import assert from 'node:assert/strict';

import { effectiveTheme, themeChoice } from '../js/theme.js';

test('the stored theme is one of system, dark or light', () => {
  assert.equal(themeChoice('system'), 'system');
  assert.equal(themeChoice('dark'), 'dark');
  assert.equal(themeChoice('light'), 'light');
});

test('a missing or hand-edited theme falls back to system', () => {
  assert.equal(themeChoice(null), 'system');
  assert.equal(themeChoice(''), 'system');
  assert.equal(themeChoice('sepia'), 'system');
});

test('system follows the device, an explicit choice does not', () => {
  assert.equal(effectiveTheme('system', true), 'dark');
  assert.equal(effectiveTheme('system', false), 'light');
  assert.equal(effectiveTheme('dark', false), 'dark');
  assert.equal(effectiveTheme('light', true), 'light');
});
