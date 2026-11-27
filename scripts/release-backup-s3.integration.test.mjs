import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { dotEnv, objects, s3Server } from './daily-backup-s3-server.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const postgres = 'postgres:17.12-alpine3.24@sha256:34261f594522cf41dfcb76aefd42b9d201098b0e6b23c9c68733f169e4218b6f';

test('release snapshot in S3 mode captures the bucket and a rollback returns it to the snapshot', { timeout: 300000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'moto-release-s3-'));
  const buckets = join(root, 's3');
  const s3 = await s3Server(t, buckets, ['uploads']);
  const cwd = join(root, 'staging'); mkdirSync(cwd);
  const project = `moto-release-s3-${process.pid}-${Date.now()}`;
  const env = { ...process.env, DEPLOY_DIR: 'staging' };
  for (const key of ['COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES']) delete env[key];
  for (const key of Object.keys(env)) if (key.startsWith('UPLOADS_')) delete env[key];
  const invoke = (command, args, input) => spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 120000 });
  const run = (command, args, input) => {
    const result = invoke(command, args, input);
    assert.equal(result.status, 0, `${command} failed: ${result.stdout}\n${result.stderr}`);
    return result;
  };
  const sql = query => run('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], query).stdout.trim();
  run('docker', ['pull', postgres]);
  const image = run('docker', ['image', 'inspect', postgres, '--format', '{{index .RepoDigests 0}}']).stdout.trim();
  writeFileSync(join(cwd, '.env'), dotEnv(s3.settings('uploads')));
  writeFileSync(join(cwd, '.deploy-state'), 'CURRENT_SHA=9c95677\n');
  // No upload volume at all: in S3 mode the bucket is the only upload store.
  writeFileSync(join(cwd, 'docker-compose.yml'), `name: ${project}
services:
  postgres:
    image: ${image}
    network_mode: none
    environment:
      POSTGRES_HOST_AUTH_METHOD: trust
    volumes:
      - database:/var/lib/postgresql/data
    healthcheck:
      test: [CMD, pg_isready, -h, 127.0.0.1, -U, postgres]
      interval: 1s
      retries: 30
  server:
    image: ${image}
    network_mode: none
    init: true
    entrypoint: [sleep, infinity]
    environment:
      UPLOADS_BACKEND: \${UPLOADS_BACKEND-}
      UPLOADS_S3_ENDPOINT: \${UPLOADS_S3_ENDPOINT-}
      UPLOADS_S3_REGION: \${UPLOADS_S3_REGION-}
      UPLOADS_S3_BUCKET: \${UPLOADS_S3_BUCKET-}
      UPLOADS_S3_ACCESS_KEY: \${UPLOADS_S3_ACCESS_KEY-}
      UPLOADS_S3_SECRET_KEY: \${UPLOADS_S3_SECRET_KEY-}
  frontend:
    image: ${image}
    network_mode: none
    init: true
    entrypoint: [sleep, infinity]
volumes:
  database:
`);
  // One hook: after hooks run in order, and Compose needs cwd to still exist.
  t.after(() => {
    spawnSync('docker', ['compose', 'down', '-v', '--remove-orphans'], { cwd, env, encoding: 'utf8' });
    rmSync(root, { recursive: true, force: true });
  });
  run('docker', ['compose', 'up', '-d', '--wait', 'postgres', 'server', 'frontend']);
  // The privileges restore asserts for the application login.
  sql(`CREATE ROLE phoenix_auth LOGIN NOINHERIT;
CREATE ROLE phoenix_tenant; CREATE ROLE phoenix_admin;
GRANT phoenix_tenant, phoenix_admin TO phoenix_auth;
CREATE SCHEMA auth; CREATE SCHEMA platform; CREATE SCHEMA active;
CREATE TABLE auth.accounts(id bigint PRIMARY KEY);
CREATE TABLE auth.account_tenants(id bigint);
CREATE TABLE platform.operators(id bigint);
CREATE TABLE active.visits(id bigint);
GRANT USAGE ON SCHEMA auth, platform, active TO phoenix_auth, phoenix_tenant, phoenix_admin;
GRANT SELECT ON auth.accounts, platform.operators TO phoenix_auth;
GRANT SELECT ON auth.account_tenants TO phoenix_tenant;
GRANT INSERT ON active.visits TO phoenix_tenant;
GRANT SELECT ON platform.operators TO phoenix_admin;
INSERT INTO auth.accounts VALUES (41);`);
  const bucket = join(buckets, 'uploads');
  s3.put('uploads', 'kept.txt', 'original');
  s3.put('uploads', '.hidden', 'hidden');
  s3.put('uploads', 'empty', '');
  s3.put('uploads', 'documents/41/A\u0308rztliche-Bescheinigung', 'sealed');
  const expected = objects(bucket);
  run('docker', ['compose', 'stop', 'server', 'frontend']);

  const bundle = join(root, 'backups/staging/release-20260914T010000Z-bbbbbbb');
  const created = run('bash', [join(scripts, 'release-backup.sh'), 'create', bundle]);
  assert(!`${created.stdout}${created.stderr}`.includes(s3.secret));
  assert.equal(readFileSync(join(bundle, 'uploads-volume'), 'utf8'), 'bucket:uploads\n');
  assert.equal(readFileSync(join(bundle, 'uploads-endpoint'), 'utf8'), `${s3.endpoint}\n`);
  assert(!existsSync(join(bundle, 'uploads-tree')));

  // Rotate at the same endpoint and revoke the snapshot's key before rollback.
  const oldCredentials = { key: s3.key, secret: s3.secret };
  await s3.rotateCredentials({ secretSuffix: '$\'"\\#' });

  sql('UPDATE auth.accounts SET id=99;');
  s3.remove('uploads', '.hidden');
  // Same size: the sync must compare checksums, not sizes.
  s3.put('uploads', 'kept.txt', 'origina1');
  s3.put('uploads', 'added.txt', 'new');
  assert.notDeepEqual(objects(bucket), expected);
  // The same bucket name at a different endpoint must fail before database or
  // object writes. Keep a distinct marker in that endpoint's bucket.
  const otherBuckets = join(root, 'other-s3');
  const other = await s3Server(t, otherBuckets, ['uploads']);
  other.put('uploads', 'other.txt', 'untouched');
  const otherExpected = objects(join(otherBuckets, 'uploads'));
  const changed = objects(bucket);
  const otherSettings = dotEnv(other.settings('uploads'));
  writeFileSync(join(cwd, '.env'), otherSettings);
  run('docker', ['compose', 'up', '-d', '--force-recreate', 'server']);
  const wrongEndpoint = invoke('bash', [join(scripts, 'restore-db.sh'), bundle]);
  assert.notEqual(wrongEndpoint.status, 0);
  assert.match(wrongEndpoint.stderr, /Snapshot holds another upload endpoint than the server uses/);
  assert.equal(sql('SELECT id FROM auth.accounts;'), '99');
  assert.deepEqual(objects(bucket), changed);
  assert.deepEqual(objects(join(otherBuckets, 'uploads')), otherExpected);
  assert.equal(readFileSync(join(cwd, '.env'), 'utf8'), otherSettings);
  writeFileSync(join(cwd, '.env'), dotEnv(s3.settings('uploads')));
  run('docker', ['compose', 'up', '-d', '--force-recreate', 'server']);
  writeFileSync(join(cwd, '.deploy-state'), 'CURRENT_SHA=bbbbbbb\nBACKUP_ID=release-20260914T010000Z-bbbbbbb\n');
  const restored = run('bash', [join(scripts, 'rollback-remote.sh'), cwd]);
  assert(!`${restored.stdout}${restored.stderr}`.includes(s3.secret));
  assert(!`${restored.stdout}${restored.stderr}`.includes(oldCredentials.secret));
  const server = run('docker', ['compose', 'ps', '-q', 'server']).stdout.trim();
  const environment = JSON.parse(run('docker', ['inspect', '--format', '{{json .Config.Env}}', server]).stdout);
  assert(environment.includes(`UPLOADS_S3_ACCESS_KEY=${s3.key}`), 'restarted server lost the rotated S3 access key');
  assert(environment.includes(`UPLOADS_S3_SECRET_KEY=${s3.secret}`), 'restarted server lost the rotated S3 secret');
  assert.equal(sql('SELECT id FROM auth.accounts;'), '41');
  assert.deepEqual(objects(bucket), expected);
  assert.deepEqual(readdirSync(cwd).filter(name => name.startsWith('.uploads-restore')), []);

  // A snapshot of one bucket never overwrites another one.
  writeFileSync(join(cwd, '.env'), dotEnv(s3.settings('other')));
  run('docker', ['compose', 'up', '-d', '--force-recreate', 'server']);
  const refused = invoke('bash', [join(scripts, 'restore-db.sh'), bundle]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Snapshot holds another bucket than the server uses/);
  assert.equal(sql('SELECT id FROM auth.accounts;'), '41');
});
