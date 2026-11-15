import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { berlinSeconds, clockBoundaries } from './clock-boundaries.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'clock-boundaries.mjs');
const times = nowIso => Object.fromEntries(clockBoundaries(Date.parse(nowIso)).map(({ at, reason }) => [at, reason]));

test('a Saturday evening in November lists the next boundaries in order', () => {
  // Saturday 2026-11-14, 22:00 Berlin.
  const boundaries = clockBoundaries(Date.parse('2026-11-14T21:00:00Z'));
  assert.deepEqual(boundaries.map(({ at }) => at), [
    '2026-11-15T00:30', '2026-11-15T23:30', '2026-11-21T00:30', '2026-12-14T00:30',
    '2026-12-24T12:00', '2026-12-25T00:30', '2026-12-26T00:30', '2026-12-31T12:00',
    '2027-01-01T00:30', '2027-02-12T00:30', '2027-03-28T00:30', '2027-03-29T00:30',
    '2027-11-14T00:30',
  ]);
  assert.equal(boundaries[0].reason, 'Berliner Tag vor dem UTC-Tag');
});

test('coinciding reasons share one run', () => {
  // Friday 2026-12-11: tomorrow is the Saturday.
  assert.equal(times('2026-12-11T10:00:00Z')['2026-12-12T00:30'], 'Berliner Tag vor dem UTC-Tag, Samstag');
  assert.equal(times('2026-11-14T21:00:00Z')['2027-01-01T00:30'], 'Neujahr, Feiertag in NRW');
});

test('the autumn clock change and its following day are found', () => {
  const listed = times('2027-10-20T10:00:00Z');
  assert.equal(listed['2027-10-31T00:30'], 'Tag der Zeitumstellung');
  assert.equal(listed['2027-11-01T00:30'], 'Tag nach der Zeitumstellung, Feiertag in NRW');
});

test('Easter holidays include the day before Karfreitag', () => {
  const listed = times('2027-03-01T10:00:00Z');
  assert.equal(listed['2027-03-25T12:00'], 'Tag vor dem Feiertag 2027-03-26');
  assert.equal(listed['2027-03-26T00:30'], 'Feiertag in NRW');
  assert.equal(listed['2027-03-29T00:30'], 'Tag nach der Zeitumstellung, Feiertag in NRW');
});

test('Berlin wall-clock times convert across both clock offsets', () => {
  assert.equal(berlinSeconds('2027-04-20T00:30'), Date.parse('2027-04-19T22:30:00Z') / 1000);
  assert.equal(berlinSeconds('2027-01-01'), Date.parse('2026-12-31T23:00:00Z') / 1000);
  assert.throws(() => berlinSeconds('20.04.2027'), /not YYYY-MM-DD/);
});

test('the command line prints tab-separated lines and Unix seconds', () => {
  const lines = execFileSync('node', [script, String(Date.parse('2026-11-14T21:00:00Z') / 1000)], { encoding: 'utf8' })
    .trim().split('\n');
  assert.equal(lines[0], '2026-11-15T00:30\tBerliner Tag vor dem UTC-Tag');
  assert.equal(execFileSync('node', [script, '--at', '2027-04-20T00:30'], { encoding: 'utf8' }).trim(), '1808173800');
});
