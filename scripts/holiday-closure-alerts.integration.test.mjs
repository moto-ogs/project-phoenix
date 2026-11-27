import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { startLoki } from './logql-alerts-fixture.mjs';

// Evaluate the provisioned LogQL with real Loki, including recovery and a
// stopped worker. No application or production service is contacted.
test('holiday closure alerts cover overdue work, recovery and a missing watchdog', { timeout: 90000 }, async t => {
  const rules = readFileSync(new URL('../monitoring/grafana/provisioning/alerting/holiday-closure-notifications.yml', import.meta.url), 'utf8');
  const expressions = [...rules.matchAll(/expr: '([^']+)'/g)].map(match => match[1]);
  assert.equal(expressions.length, 2);
  // The alert window includes logs older than Loki's default 2 h chunk age.
  const request = await startLoki(t, '-ingester.max-chunk-age=60h');
  const now = Date.now();
  const hour = 3600000;
  const stamp = ms => String(BigInt(ms) * 1000000n);
  const push = (ms, record, env = 'prod') => {
    const line = JSON.stringify({ time: new Date(ms).toISOString(), ...record });
    const result = request('/loki/api/v1/push', { streams: [
      { stream: { env, service: 'worker' }, values: [[stamp(ms), line]] },
    ] });
    assert.equal(result.status, 0, 'synthetic log ingestion failed');
  };
  const value = (index, at = now) => {
    const result = request(`/loki/api/v1/query?query=${encodeURIComponent(expressions[index])}&time=${stamp(at)}`);
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.status, 'success');
    assert.equal(body.data.result.length, 1);
    return Number(body.data.result[0].value[1]);
  };
  const checked = overdue => ({ level: 'INFO', msg: 'holiday closure watchdog checked', overdue });
  assert.equal(value(1), 0, 'no heartbeat alerts even with the worker stopped');
  push(now - 120000, checked(5));
  assert.equal(value(0), 5, 'old commands and blocked work alert');
  assert.ok(value(1) >= 1, 'the watchdog heartbeat is present');
  push(now - 60000, checked(0));
  assert.equal(value(0), 0, 'the latest healthy observation resolves the alarm');
  push(now - 30000, checked(8), 'staging');
  assert.equal(value(0), 0, 'staging cannot trigger the production alarm');
  assert.equal(value(1, now + 11 * 60000), 0, 'a stopped watchdog alerts after ten minutes');
});
