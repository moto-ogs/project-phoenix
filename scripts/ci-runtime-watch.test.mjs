import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LABEL, MIN_RUNS, RECENT_DAYS, TITLE, decide, issueBody, main, measureRun, median, renderReport, sampleRuns, selectRuns, summarize, windowSlices,
} from './ci-runtime-watch.mjs';

const at = s => new Date(Date.UTC(2026, 10, 9, 8, 0, s)).toISOString();
const job = (name, from, to, extra = {}) => ({
  name, started_at: at(from), completed_at: at(to), conclusion: 'success', runner_name: 'r', ...extra,
});
const run = (id, extra = {}) => ({
  id, event: 'pull_request', conclusion: 'success', run_attempt: 1, created_at: at(id), html_url: `https://x/runs/${id}`, ...extra,
});

test('windowSlices covers the window in one-day slices without overlap', () => {
  const slices = windowSlices(new Date('2026-11-16T04:23:00Z'), 7);
  assert.equal(slices.length, 7);
  assert.deepEqual(slices[0], { from: '2026-11-09T04:23:00Z', to: '2026-11-10T04:22:59Z' });
  assert.equal(slices[6].to, '2026-11-16T04:22:59Z');
});

test('selectRuns keeps green first attempts of pull requests once, oldest first', () => {
  const runs = [
    run(3), run(1), run(1), run(2, { run_attempt: 2 }), run(4, { conclusion: 'failure' }), run(5, { event: 'push' }),
  ];
  assert.deepEqual(selectRuns(runs).map(r => r.id), [1, 3]);
});

test('sampleRuns spreads evenly and keeps small lists whole', () => {
  const runs = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(sampleRuns(runs, 20), runs);
  assert.deepEqual(sampleRuns(runs, 5), [0, 2, 4, 6, 8]);
});

test('measureRun times first job start to ci-gate end and finds the last job', () => {
  const jobs = [
    job('Detect changes', 0, 10),
    job('Test / Backend tests (0)', 12, 250),
    job('Lint / Frontend build', 12, 200),
    job('Lint / Error code registry', 0, 0, { conclusion: 'skipped', runner_name: null }),
    job('ci-gate', 255, 270),
    // The CI cost check run joins the suite without a runner, after ci-gate.
    job('CI cost', 280, 281, { conclusion: 'neutral', runner_name: null }),
  ];
  assert.deepEqual(measureRun(run(7), jobs), {
    id: 7, url: 'https://x/runs/7', branch: undefined, createdAt: at(7), seconds: 270, backendSeconds: 238, lastJob: 'Test / Backend tests (0)',
  });
});

test('measureRun skips runs without a passing ci-gate and marks runs without backend tests', () => {
  assert.equal(measureRun(run(1), [job('Detect changes', 0, 10), job('ci-gate', 0, 0, { conclusion: 'skipped' })]), null);
  const row = measureRun(run(2), [
    job('Detect changes', 0, 10), job('Test / Backend tests (0)', 0, 0, { conclusion: 'skipped', runner_name: null }), job('ci-gate', 60, 70),
  ]);
  assert.equal(row.backendSeconds, null);
  assert.equal(row.seconds, 70);
});

test('median handles odd, even and empty lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

const rows = (count, seconds, backend = true, createdAt = '2026-11-10T08:00:00Z') =>
  Array.from({ length: count }, (_, i) => ({
    id: i, url: `https://x/runs/${i}`, createdAt, seconds: seconds + i, backendSeconds: backend ? seconds - 30 : null, lastJob: backend ? 'Test / Backend tests (0)' : 'Lint / Frontend build',
  }));

test('decide needs enough backend runs and compares their median with the threshold', () => {
  const stats = runs => summarize(runs, { listed: runs.length, sampled: runs.length });
  assert.equal(decide(stats(rows(MIN_RUNS - 1, 400))), 'insufficient');
  assert.equal(decide(stats([...rows(MIN_RUNS, 295), ...rows(20, 500, false)])), 'ok');
  assert.equal(decide(stats(rows(MIN_RUNS, 296))), 'over');
});

const week = windowSlices(new Date('2026-11-16T04:23:00Z'), 7);

test('the recent days decide once they hold enough runs', () => {
  const stats = runs => summarize(runs, { listed: runs.length, sampled: runs.length, slices: week });
  const old = (count, seconds) => rows(count, seconds, true, '2026-11-10T08:00:00Z');
  const fresh = (count, seconds) => rows(count, seconds, true, '2026-11-14T08:00:00Z');
  // #7195: four slow days, repaired since. The week is over, the cause is gone.
  const repaired = stats([...old(40, 600), ...fresh(MIN_RUNS, 260)]);
  assert.ok(repaired.backend.median > 300);
  assert.equal(decide(repaired), 'ok');
  // A regression of the last days is not hidden behind a fast week.
  const regressed = stats([...old(40, 250), ...fresh(MIN_RUNS, 400)]);
  assert.ok(regressed.backend.median < 300);
  assert.equal(decide(regressed), 'over');
  // Too few recent runs say nothing: the week decides.
  assert.equal(decide(stats([...old(40, 600), ...fresh(MIN_RUNS - 1, 260)])), 'over');
  assert.equal(decide(stats([...old(40, 250), ...fresh(MIN_RUNS - 1, 400)])), 'ok');
});

test('summarize reports the recent days and one row per day', () => {
  const stats = summarize(
    [...rows(3, 600, true, '2026-11-10T08:00:00Z'), ...rows(1, 100, false, '2026-11-10T09:00:00Z'), ...rows(2, 260, true, '2026-11-14T08:00:00Z')],
    { listed: 6, sampled: 6, slices: week },
  );
  assert.deepEqual(stats.recent, { runs: 2, median: 260.5 });
  assert.equal(stats.days.length, 7);
  assert.deepEqual(stats.days[1], { from: '2026-11-10T04:23:00Z', runs: 3, median: 601, backendJob: 570 });
  assert.deepEqual(stats.days[5], { from: '2026-11-14T04:23:00Z', runs: 2, median: 260.5, backendJob: 230 });
  assert.deepEqual(stats.days[6], { from: '2026-11-15T04:23:00Z', runs: 0, median: null, backendJob: null });
});

test('a window no longer than the recent days is judged as a whole', () => {
  const slices = windowSlices(new Date('2026-11-16T04:23:00Z'), RECENT_DAYS);
  const runs = rows(MIN_RUNS, 400, true, '2026-11-14T08:00:00Z');
  const stats = summarize(runs, { listed: runs.length, sampled: runs.length, slices });
  assert.deepEqual(stats.recent, { runs: 0, median: null });
  assert.equal(decide(stats), 'over');
  const report = renderReport(stats, decide(stats), { repo: 'o/r', from: slices[0].from, to: slices.at(-1).to });
  assert.doesNotMatch(report, /letzten? 3 Tage/);
});

test('the report says which runs decided and lists the days', () => {
  const runs = [...rows(40, 600, true, '2026-11-10T08:00:00Z'), ...rows(12, 320, true, '2026-11-14T08:00:00Z')];
  const stats = summarize(runs, { listed: 52, sampled: 52, slices: week });
  const report = renderReport(stats, decide(stats), { repo: 'o/r', from: '2026-11-09T04:23:00Z', to: '2026-11-16T04:22:59Z' });
  assert.match(report, new RegExp(`\\*\\*Über dem Ziel:\\*\\* Der Median der Läufe mit Backend-Tests der letzten ${RECENT_DAYS} Tage liegt bei 326 s, die Obergrenze ist 300 s\\. Im ganzen Zeitraum sind es 614 s\\.`));
  assert.match(report, /\| Läufe mit Backend-Tests, letzte 3 Tage \| 12 \| 326 s \|/);
  assert.match(report, /\| 2026-11-10 04:23 \| 40 \| 620 s \| 570 s \|/);
  assert.match(report, /\| 2026-11-13 04:23 \| 0 \| – \| – \|\n\| 2026-11-14 04:23 \| 12 \| 326 s \| 290 s \|/);
});

test('summarize reports both medians, the backend job and the most frequent last jobs', () => {
  const stats = summarize([...rows(3, 300), ...rows(2, 100, false)], { listed: 9, sampled: 5 });
  assert.deepEqual(stats.all, { runs: 5, median: 300 });
  assert.deepEqual(stats.backend, { runs: 3, median: 301 });
  assert.deepEqual(stats.backendJob, { median: 270 });
  assert.deepEqual(stats.lastJobs, [['Test / Backend tests (0)', 3], ['Lint / Frontend build', 2]]);
  assert.equal(stats.slowest[0].seconds, 302);
});

test('the report names the numbers, the slowest runs and the rule', () => {
  const stats = summarize(rows(12, 320), { listed: 400, sampled: 250 });
  const report = renderReport(stats, decide(stats), { repo: 'o/r', from: '2026-11-09T04:23:00Z', to: '2026-11-16T04:22:59Z' });
  assert.match(report, /\*\*Über dem Ziel:\*\* Der Median der Läufe mit Backend-Tests liegt bei 326 s, die Obergrenze ist 300 s\./);
  assert.match(report, /Stichprobe von 250 aus 400/);
  assert.match(report, /\| Job `Test \/ Backend tests` \| 12 \| 290 s \|/);
  assert.match(report, /- \[11\]\(https:\/\/x\/runs\/11\) 331 s, Backend-Tests 290 s/);
  assert.match(report, /https:\/\/github\.com\/o\/r\/blob\/development\/\.claude\/rules\/ci-test-performance\.md/);
  assert.match(issueBody(report), /schließt dieses Issue nicht/);
});

function fakeApi({ issues = [], gateSeconds = 400, backend = true }) {
  const sent = [];
  const runs = Array.from({ length: MIN_RUNS }, (_, i) => run(i + 1));
  return {
    sent,
    async get(path) {
      if (path.includes('/workflows/main.yml/runs')) return { workflow_runs: path.includes('page=1') && runs.length ? runs.splice(0) : [] };
      if (path.includes('/jobs')) {
        return { jobs: [job('Detect changes', 0, 10), job('Test / Backend tests (0)', backend ? 10 : 0, gateSeconds - 10, backend ? {} : { conclusion: 'skipped' }), job('ci-gate', gateSeconds - 5, gateSeconds)] };
      }
      if (path.includes('/issues?')) return issues;
      throw new Error(`unexpected ${path}`);
    },
    async send(method, path, body) {
      sent.push({ method, path, body });
      return { number: 99 };
    },
  };
}

const env = { GITHUB_REPOSITORY: 'o/r' };
const quiet = async fn => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

test('main opens one labelled issue when over the threshold', async () => {
  const api = fakeApi({});
  assert.deepEqual(await quiet(() => main(env, api, [])), { decision: 'over', action: 'create' });
  assert.equal(api.sent.length, 1);
  assert.equal(api.sent[0].path, '/repos/o/r/issues');
  assert.equal(api.sent[0].body.title, TITLE);
  assert.deepEqual(api.sent[0].body.labels, [LABEL, 'needs-triage']);
});

test('main comments on the open issue instead of opening a second one', async () => {
  const api = fakeApi({ issues: [{ number: 5, title: 'other' }, { number: 7, title: TITLE }] });
  assert.deepEqual(await quiet(() => main(env, api, [])), { decision: 'over', action: 'comment' });
  assert.deepEqual(api.sent.map(s => s.path), ['/repos/o/r/issues/7/comments']);
});

test('main writes nothing in dry-run, under the threshold or without backend runs', async () => {
  for (const [options, args, decision] of [
    [{}, ['--dry-run'], 'over'],
    [{ gateSeconds: 290 }, [], 'ok'],
    [{ backend: false }, [], 'insufficient'],
  ]) {
    const api = fakeApi(options);
    assert.equal((await quiet(() => main(env, api, args))).decision, decision);
    assert.deepEqual(api.sent, []);
  }
});
