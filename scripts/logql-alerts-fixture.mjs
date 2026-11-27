import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

export async function startLoki(t, ...flags) {
  const name = `moto-alert-test-${randomUUID()}`;
  const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  t.after(() => docker('rm', '-f', name));
  const started = docker('run', '-d', '--name', name, '--network', 'none',
    'grafana/loki:3.4.3', '-config.file=/etc/loki/local-config.yaml',
    // One process serves and executes queries; scheduler discovery otherwise waits 10s.
    '-querier.frontend-address=127.0.0.1:9095', '-ingester.min-ready-duration=0s',
    '-querier.query-ingesters-within=0', '-querier.split-queries-by-interval=0',
    '-querier.cache-results=false', ...flags);
  assert.equal(started.status, 0, started.stderr);

  const request = (path, payload) => docker('exec', name, '/busybox/wget', '-qO-',
    ...(payload ? ['--header=Content-Type: application/json', `--post-data=${JSON.stringify(payload)}`] : []),
    `http://127.0.0.1:3100${path}`);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (request('/ready').status === 0) return request;
    await setTimeout(500);
  }
  assert.fail('isolated Loki did not become ready');
}
