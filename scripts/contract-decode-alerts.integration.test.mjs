import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';

// Runs the LogQL of the contract decode alert (#7809) against an isolated Loki
// with lines in the shape the frontend's server logger writes them.
test('contract decode LogQL alerts per route on the first rejected answer', { timeout: 90000 }, async t => {
  const rules = readFileSync(new URL('../monitoring/grafana/provisioning/alerting/contract-decode.yml', import.meta.url), 'utf8');
  const expressions = [...rules.matchAll(/expr: '([^']+)'/g)].map(match => match[1]);
  assert.equal(expressions.length, 1);
  const threshold = Number(rules.match(/params: \[(\d+)\]/)[1]);
  const name = `moto-contract-decode-alert-test-${process.pid}-${Date.now()}`;
  const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  t.after(() => docker('rm', '-f', name));
  const started = docker('run', '-d', '--name', name, '--network', 'none',
    'grafana/loki:3.4.3', '-config.file=/etc/loki/local-config.yaml',
    '-ingester.min-ready-duration=0s', '-querier.query-ingesters-within=0',
    '-querier.split-queries-by-interval=0', '-querier.cache-results=false');
  assert.equal(started.status, 0, started.stderr);
  const request = (path, payload) => docker('exec', name, '/busybox/wget', '-qO-',
    ...(payload ? ['--header=Content-Type: application/json', `--post-data=${JSON.stringify(payload)}`] : []),
    `http://127.0.0.1:3100${path}`);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (request('/ready').status === 0) { ready = true; break; }
    await setTimeout(500);
  }
  assert.ok(ready, 'isolated Loki did not become ready');
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
  assert.deepEqual(firing(), ['GET /api/groups/{id}', 'POST /api/rooms/'],
    'other frontend lines, staging and server lines do not alert');
});
