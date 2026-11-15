import assert from 'node:assert/strict';
import test from 'node:test';

import { dailyBackupRig, roleRestoreMatrix } from './daily-backup-test-rig.mjs';

test('daily restore quarantines a safe billing retention login and refuses unsafe roles', { timeout: 1200000 }, t => {
  const counts = roleRestoreMatrix(t, dailyBackupRig(t), ['billing_retention']);
  // The safe login alone, 13 unsafe role states, a second reserved group and a group that logs in.
  assert.deepEqual(counts, { accepted: 1, rejected: 15 });
});
