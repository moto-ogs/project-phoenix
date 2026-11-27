import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { startLoki } from './logql-alerts-fixture.mjs';

// Runs the LogQL of the contract decode alert (#7809) against an isolated Loki
// with lines in the shape the frontend's server logger writes them.
test('contract decode LogQL alerts per route on the first rejected answer', { timeout: 90000 }, async t => {
  const rules = readFileSync(new URL('../monitoring/grafana/provisioning/alerting/contract-decode.yml', import.meta.url), 'utf8');
  const expressions = [...rules.matchAll(/expr: '([^']+)'/g)].map(match => match[1]);
  assert.equal(expressions.length, 1);
  const threshold = Number(rules.match(/params: \[(\d+)\]/)[1]);
  const request = await startLoki(t);
  const now = Date.now();
  const minute = 60000;
  const stamp = ms => String(BigInt(ms) * 1000000n);
  const push = (ms, record, env = 'prod', service = 'frontend') => {
    const line = JSON.stringify({ timestamp: new Date(ms).toISOString(), component: 'Contract', context: 'server', ...record });
    const result = request('/loki/api/v1/push', { streams: [
      { stream: { env, service }, values: [[stamp(ms), line]] },
    ] });
    assert.equal(result.status, 0, 'synthetic log ingestion failed');
  };
  const rejected = (route, write = false) => ({
    level: 'error', msg: 'contract_decode_failed', route, write, issues: ['data.0.id: invalid_type'],
  });
  const firing = () => {
    const result = request(`/loki/api/v1/query?query=${encodeURIComponent(expressions[0])}&time=${stamp(now)}`);
    assert.equal(result.status, 0, 'LogQL query failed');
    const body = JSON.parse(result.stdout);
    assert.equal(body.status, 'success');
    return body.data.result
      .filter(series => Number(series.value[1]) > threshold)
      .map(series => series.metric.route)
      .sort();
  };

  assert.deepEqual(firing(), [], 'no lines, no alert');
  push(now - 7 * minute, rejected('GET /api/rooms/'));
  assert.deepEqual(firing(), [], 'a line older than 5 minutes does not alert');

  push(now - 3 * minute, rejected('GET /api/groups/{id}'));
  push(now - 2 * minute, rejected('POST /api/rooms/', true));
  push(now - 2 * minute, rejected('GET /api/groups/{id}'));
  assert.deepEqual(firing(), ['GET /api/groups/{id}', 'POST /api/rooms/'], 'one alert per route from the first line');

  push(now - minute, { level: 'error', msg: 'error_displayed', error_code: 'general.write_answer_unreadable' });
  push(now - minute, rejected('GET /api/students/'), 'staging');
  push(now - minute, rejected('GET /api/visits/'), 'prod', 'server');
  // The browser log endpoint writes to the same stream; a client cannot forge the alert.
  push(now - minute, { ...rejected('GET /api/forged/'), context: 'client', provenance: 'client_log' });
  assert.deepEqual(firing(), ['GET /api/groups/{id}', 'POST /api/rooms/'],
    'other frontend lines, staging, server and client log lines do not alert');
});
