// The name a reader types is the name every derived file keeps. Dropbox's
// `path_lower` is for comparison only: once it reached a displayed name, a
// backup path or a PDF path, capitals came back lowercased.
import test from 'node:test';
import assert from 'node:assert/strict';

import { backupPath } from '../js/backup.js';
import { pdfPathFor } from '../js/pdf.js';
import { renamedPath } from '../js/paths.js';
import {
  parseShareRecords,
  pdfNeedsPublish,
  recordPdfShare,
  shareFingerprint,
  shareKey,
} from '../js/share.js';

test('files named after a note keep the case the reader typed', () => {
  assert.equal(backupPath('/My Trip.md'), '/My Trip.md.bak');
  assert.equal(pdfPathFor('/My Trip.md'), '/My Trip.pdf');
  assert.equal(renamedPath('/Holidays/old.md', 'My Trip'), '/Holidays/My Trip.md');
});

test('share records are keyed by the lowercase path, whatever the spelling', () => {
  assert.equal(shareKey('/My Trip.md'), '/my trip.md');
  assert.equal(shareKey('/My Trip.md'), shareKey('/my trip.md'));
});

test('a record written before display paths still matches the note', () => {
  const key = shareKey('/My Trip.md');
  const records = recordPdfShare({}, key, shareFingerprint('first'));
  assert.equal(pdfNeedsPublish(records, shareKey('/My Trip.md'), 'first'), false);
  assert.equal(pdfNeedsPublish(records, shareKey('/My Trip.md'), 'second'), true);
});

test('records parsed from storage keep their lowercase keys', () => {
  const raw = JSON.stringify({ '/my trip.md': { hash: 'abc', at: 1 } });
  const records = parseShareRecords(raw);
  assert.equal(records['/my trip.md'].hash, 'abc');
  assert.equal(pdfNeedsPublish(records, shareKey('/My Trip.md'), 'anything'), true);
});
