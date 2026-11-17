import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { collect, failures, isRed, LABEL, renderSummary, report, SUITES, TITLE } from './clock-early-warning.mjs';

const event = fields => JSON.stringify({ Time: '2027-04-20T00:31:00+02:00', ...fields });
const json = (...events) => events.join('\n') + '\n';

function resultsDir(times, files) {
  const dir = mkdtempSync(join(tmpdir(), 'clock-early-warning-'));
  writeFileSync(join(dir, 'times.tsv'), times.map(([at, reason]) => `${at}\t${reason}\n`).join(''));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test('failed tests list the deepest subtest, build failures their package', () => {
  const listed = failures(json(
    event({ Action: 'pass', Package: 'x/a', Test: 'TestGreen' }),
    event({ Action: 'fail', Package: 'x/a', Test: 'TestParent/case' }),
    event({ Action: 'fail', Package: 'x/a', Test: 'TestParent' }),
    event({ Action: 'fail', Package: 'x/a' }),
    event({ Action: 'fail', Package: 'x/b' }),
    'not json',
  ));
  assert.deepEqual(listed, ['x/a TestParent/case', 'x/b (Paket)']);
});

test('the summary names every time and the failures of red ones', () => {
  const dir = resultsDir([['2027-04-20T00:30', 'heute + 90 Tage'], ['2027-05-06T00:30', 'Feiertag in NRW'], ['2027-05-07T00:30', 'Samstag']], {
    'go-test-2027-04-20T0030.json': json(event({ Action: 'pass', Package: 'x/a' })),
    'go-test-2027-05-06T0030.json': json(event({ Action: 'fail', Package: 'x/a', Test: 'TestDue' })),
  });
  const results = collect(dir);
  assert.equal(isRed(results), true);
  const summary = renderSummary(results);
  assert.match(summary, /\| 2027-04-20T00:30 \| heute \+ 90 Tage \| grün \|/);
  assert.match(summary, /\| 2027-05-06T00:30 \| Feiertag in NRW \| 1 rot \|/);
  assert.match(summary, /\| 2027-05-07T00:30 \| Samstag \| kein Ergebnis \|/);
  assert.match(summary, /#### 2027-05-06T00:30 \(Feiertag in NRW\)\n\n- `x\/a TestDue`/);
});

test('a green run reports nothing; a run without results is red', async () => {
  const green = resultsDir([['2027-04-20T00:30', 'x']], {
    'go-test-2027-04-20T0030.json': json(event({ Action: 'pass', Package: 'x/a' })),
  });
  const api = { get: () => assert.fail('no API call'), send: () => assert.fail('no API call') };
  assert.deepEqual(await report({ GITHUB_REPOSITORY: 'o/r' }, api, green), { action: 'none' });
  assert.equal(isRed(collect(mkdtempSync(join(tmpdir(), 'clock-early-warning-')))), true);
});

test('a red run comments on the open issue or opens one', async () => {
  const dir = resultsDir([['2027-05-06T00:30', 'Feiertag in NRW']], {
    'go-test-2027-05-06T0030.json': json(event({ Action: 'fail', Package: 'x/a', Test: 'TestDue' })),
  });
  const env = { GITHUB_REPOSITORY: 'o/r', RUN_URL: 'https://example.test/run/1' };
  const sent = [];
  const api = issues => ({
    get: async path => {
      assert.match(path, new RegExp(`labels=${LABEL}`));
      return issues;
    },
    send: async (method, path, body) => {
      sent.push({ method, path, body });
      return { number: 9 };
    },
  });
  assert.deepEqual(await report(env, api([{ number: 7, title: TITLE }]), dir), { action: 'comment' });
  assert.equal(sent[0].path, '/repos/o/r/issues/7/comments');
  assert.match(sent[0].body.body, /Lauf: https:\/\/example\.test\/run\/1/);
  assert.deepEqual(await report(env, api([{ number: 8, title: 'other' }]), dir), { action: 'create' });
  assert.equal(sent[1].path, '/repos/o/r/issues');
  assert.deepEqual(sent[1].body.labels, [LABEL, 'needs-triage']);
  assert.match(sent[1].body.body, /x\/a TestDue/);
  sent.length = 0;
  assert.deepEqual(await report(env, api([]), dir, { dryRun: true }), { action: 'create (dry-run)' });
  assert.equal(sent.length, 0);
});

const vitestReport = (...files) => JSON.stringify({
  testResults: files.map(([name, status, tests = [], message = '']) => ({
    name: `/runner/work/project-phoenix/frontend/${name}`,
    status,
    message,
    assertionResults: tests.map(([fullName, testStatus]) => ({ fullName, status: testStatus })),
  })),
});

test('frontend failures name file and test; a file that fails without one is listed itself', () => {
  const listed = failures(vitestReport(
    ['src/a.test.tsx', 'failed', [['week view marks today', 'failed'], ['week view renders', 'passed']]],
    ['src/b.test.ts', 'passed', [['adds', 'passed']]],
    ['src/c.test.ts', 'failed', [], 'SyntaxError'],
  ), 'frontend');
  assert.deepEqual(listed, ['src/a.test.tsx > week view marks today', 'src/c.test.ts (Datei)']);
});

test('the frontend suite reads the Vitest reports and reports under its own issue', async () => {
  const dir = resultsDir([['2027-03-28T00:30', 'Tag der Zeitumstellung'], ['2027-03-29T00:30', 'Tag danach']], {
    'vitest-2027-03-28T0030.json': vitestReport(['src/a.test.tsx', 'failed', [['marks today', 'failed']]]),
    // A backend result in the same directory belongs to the other suite.
    'go-test-2027-03-29T0030.json': json(event({ Action: 'pass', Package: 'x/a' })),
  });
  const results = collect(dir, 'frontend');
  assert.deepEqual(results.map(result => result.ran), [true, false]);
  const summary = renderSummary(results, 'frontend');
  assert.match(summary, /^### Frontend-Tests mit verstellter Uhr/);
  assert.match(summary, /\| 2027-03-28T00:30 \| Tag der Zeitumstellung \| 1 rot \|/);
  assert.match(summary, /- `src\/a\.test\.tsx > marks today`/);
  assert.match(summary, /test-frontend-clocks\.sh/);
  assert.doesNotMatch(summary, /PostgreSQL/);

  const sent = [];
  const api = {
    get: async () => [{ number: 7, title: TITLE }],
    send: async (method, path, body) => {
      sent.push({ path, body });
      return { number: 9 };
    },
  };
  const env = { GITHUB_REPOSITORY: 'o/r', RUN_URL: 'https://example.test/run/2' };
  // The open backend issue is not the frontend's: the suite opens its own.
  assert.deepEqual(await report(env, api, dir, { suite: 'frontend' }), { action: 'create' });
  assert.equal(sent[0].body.title, SUITES.frontend.title);
  assert.notEqual(SUITES.frontend.title, TITLE);
  assert.match(sent[0].body.body, /frontend-testing\.md/);
});

test('a frontend run that exits red without a red test is still red', () => {
  // Vitest exits 1 for an unhandled rejection while every test passed.
  const dir = resultsDir([['2027-03-28T00:30', 'Tag der Zeitumstellung'], ['2027-03-29T00:30', 'Tag danach']], {
    'vitest-2027-03-28T0030.json': vitestReport(['src/a.test.tsx', 'passed', [['adds', 'passed']]]),
    'vitest-2027-03-28T0030.exit': '1\n',
    'vitest-2027-03-29T0030.json': vitestReport(['src/a.test.tsx', 'passed', [['adds', 'passed']]]),
  });
  const results = collect(dir, 'frontend');
  assert.deepEqual(results.map(result => result.failed), [['Lauf endete mit Status 1 ohne roten Test (Log des Laufs lesen)'], []]);
  assert.equal(isRed(results), true);
});
