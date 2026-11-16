// "Warm backend build cache" (backend-build-cache.yml) writes the migrated
// database snapshot every pull request's "Backend tests" job (test.yml)
// restores. A cache entry is found only under the same key and path, and a
// dump is restored by the server version that wrote it: a drift between the
// two files sends every pull request back to the migrate path without
// failing anything (#7195).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
const tests = read('test.yml');
const warm = read('backend-build-cache.yml');

// The text of one step, up to the next one.
function step(source, name) {
  const start = source.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `step ${name} exists`);
  const next = source.indexOf('\n      - name: ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}
const field = (block, key) => block.match(new RegExp(`^ +${key}: (.*)$`, 'm'))?.[1];
const env = (block, key) => field(block, key)?.replace(/^"(.*)"$/, '$1');

test('the development writer saves the snapshot under the key and path pull requests restore', () => {
  const restore = step(tests, 'Restore migrated DB snapshot');
  const key = field(restore, 'key');
  assert.match(key, /^db-snapshot-.*hashFiles\('backend\/database\/migrations\/\*\.go', 'backend\/cmd\/migrate\.go'\)/);
  for (const name of ['Look up migrated DB snapshot', 'Save migrated DB snapshot']) {
    assert.equal(field(step(warm, name), 'key'), key, `${name}: key`);
    assert.equal(field(step(warm, name), 'path'), field(restore, 'path'), `${name}: path`);
  }
  assert.equal(field(step(warm, 'Look up migrated DB snapshot'), 'lookup-only'), 'true');
});

test('the writer dumps from the Postgres image the test job restores into', () => {
  const service = tests.match(/^ {6}postgres:\n {8}image: (\S+)$/m)?.[1];
  assert.ok(service, 'test.yml pins the postgres service image');
  assert.equal(field(step(warm, 'Migrate a fresh database and dump it'), 'POSTGRES_IMAGE'), service);
});

test('the writer migrates with the settings of the test job', () => {
  const theirs = step(tests, 'Run database migrations');
  const ours = step(warm, 'Migrate a fresh database and dump it');
  assert.match(theirs, /^ +run: go run main\.go migrate$/m);
  assert.match(ours, /^ +go run main\.go migrate$/m);
  for (const key of ['DB_DSN', 'DB_MAX_OPEN_CONNS', 'DB_MAX_IDLE_CONNS', 'DB_CONN_MAX_LIFETIME', 'DB_CONN_MAX_IDLE_TIME', 'PHOENIX_AUTH_PASSWORD', 'PHOENIX_DEMO_PASSWORD']) {
    assert.ok(env(theirs, key), `test.yml sets ${key}`);
    assert.equal(env(ours, key), env(theirs, key), key);
  }
});

test('a migration change on development starts the writer', () => {
  assert.match(warm, /^ {6}- 'backend\/\*\*'$/m);
});
