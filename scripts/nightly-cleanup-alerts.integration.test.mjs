import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { startLoki } from './logql-alerts-fixture.mjs';

// Runs the LogQL of the nightly cleanup alert (#6327) against an isolated Loki
// with log lines in the shape the Worker writes them.
test('nightly cleanup LogQL alerts per school and job and ends with the recovery', { timeout: 90000 }, async t => {
  const rules = readFileSync(new URL('../monitoring/grafana/provisioning/alerting/nightly-cleanup.yml', import.meta.url), 'utf8');
  const expressions = [...rules.matchAll(/expr: '([^']+)'/g)].map(match => match[1]);
  assert.equal(expressions.length, 1);
  const threshold = Number(rules.match(/params: \[(\d+)\]/)[1]);
  // The alert window includes logs older than Loki's default 2 h chunk age.
  const request = await startLoki(t, '-ingester.max-chunk-age=60h');
  const now = Date.now();
  const hour = 3600000;
  const stamp = ms => String(BigInt(ms) * 1000000n);
  const push = (ms, record, env = 'prod', service = 'worker') => {
    const line = JSON.stringify({ time: new Date(ms).toISOString(), ...record });
    const result = request('/loki/api/v1/push', { streams: [
      { stream: { env, service }, values: [[stamp(ms), line]] },
    ] });
    assert.equal(result.status, 0, 'synthetic log ingestion failed');
  };
  const failing = (tenant, job, failures) => ({
    level: 'ERROR', msg: 'nightly cleanup failing repeatedly', job_id: job, tenant_id: tenant,
    consecutive_failures: failures, failed_steps: 'feedback', error: 'data cleanup incomplete',
  });
  const recovered = (tenant, job, previous) => ({
    level: 'INFO', msg: 'nightly cleanup recovered', job_id: job, tenant_id: tenant,
    consecutive_failures: 0, previous_failures: previous,
  });
  // firing returns "tenant/job" of every series above the rule's threshold.
  const firing = () => {
    const result = request(`/loki/api/v1/query?query=${encodeURIComponent(expressions[0])}&time=${stamp(now)}`);
    assert.equal(result.status, 0, 'LogQL query failed');
    const body = JSON.parse(result.stdout);
    assert.equal(body.status, 'success');
    return body.data.result
      .filter(series => Number(series.value[1]) > threshold)
      .map(series => `${series.metric.tenant_id}/${series.metric.job_id}`)
      .sort();
  };

  // Lines of one stream go in in time order; Loki refuses older ones.
  assert.deepEqual(firing(), [], 'no lines, no alert');
  push(now - 31 * hour, failing(7, 'visit-cleanup', 9));
  assert.deepEqual(firing(), [], 'a line older than 30 hours does not alert');

  push(now - 27 * hour, failing(7, 'visit-cleanup', 6), 'prod', 'server');
  push(now - 5 * hour, failing(8, 'visit-cleanup', 3));
  push(now - 4 * hour, failing(7, 'timetable-cleanup', 4));
  assert.deepEqual(firing(), ['7/timetable-cleanup', '7/visit-cleanup', '8/visit-cleanup'],
    'one alert per school and job, also 27 hours after the last failed run');

  push(now - hour, recovered(7, 'visit-cleanup', 6));
  assert.deepEqual(firing(), ['7/timetable-cleanup', '8/visit-cleanup'], 'the recovery ends only its own alert');

  push(now - 60000, { level: 'ERROR', msg: 'cleanup step failed', tenant_id: 7, step: 'feedback', error: 'x' });
  push(now - 60000, failing(9, 'visit-cleanup', 3), 'staging');
  assert.deepEqual(firing(), ['7/timetable-cleanup', '8/visit-cleanup'], 'step errors and staging lines do not alert');
});
