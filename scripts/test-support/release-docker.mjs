#!/usr/bin/env node
// Deterministic Docker boundary for release shell failure-path tests.
import { appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
const call = args.join(' ');
appendFileSync(process.env.RELEASE_TEST_LOG, `${call}\n`);
const fail = process.env.RELEASE_TEST_FAIL;
const isCompose = args[0] === 'compose';
const input = isCompose && args.includes('psql') && !args.includes('-c') ? readFileSync(0, 'utf8') : '';
const exit = () => process.exit(9);
// The stack in the working directory decides whether the sidecar exists.
const stack = existsSync('docker-compose.yml') ? readFileSync('docker-compose.yml', 'utf8') : '';
const sidecar = stack.includes('demo-runtime');
// A maintenance-profile job that is only ever run by hand has no container.
const rekey = stack.includes('bank-data-rekey');
// Staging and production run a standalone worker (#7226).
const worker = /^  worker:$/m.test(stack);
if ((fail === 'stop' && isCompose && args.includes('stop')) ||
    (fail === 'pull' && (args[0] === 'pull' || args.includes('pull'))) ||
    (fail === 'tag' && args[0] === 'tag') ||
    (fail === 'prune' && args[0] === 'rmi') ||
    // The preflight and the migration are both `compose run migrate`; only the
    // trailing command separates them, so each failure mode names its own.
    (fail === 'migrate' && isCompose && args.includes('run') && !call.includes('migrate preflight')) ||
    (fail === 'preflight' && isCompose && args.includes('run') && call.includes('migrate preflight')) ||
    (fail === 'health' && isCompose && args.includes('up') && args.includes('frontend')) ||
    (fail === 'sidecar' && isCompose && args.includes('up') && args.includes('demo-runtime')) ||
    (fail === 'roles' && isCompose && args.includes('pg_dumpall')) ||
    (fail === 'restore-db' && isCompose && args.includes('pg_restore')) ||
    (fail === 'restore-roles' && input.includes('CREATE ROLE')) ||
    (fail === 'unavailable-image' && (args[0] === 'pull' || (args[0] === 'image' && !args.includes('--format')))) ||
    (fail === 'archive' && args.includes('-tzf')) ||
    (fail === 'server-env' && args[0] === 'inspect' && args[2].includes('.Config.Env')) ||
    (fail === 'bucket-copy' && args[0] === 'run' && args.includes('copy')) ||
    (fail === 'acl-disabled' && args.includes('sync') && args.some(arg => /^RCLONE_CONFIG_UPLOADS_ACL=.+/.test(arg))) ||
    (fail === 'restore-uploads' && args.includes('-c'))) exit();
if (isCompose && args.includes('ps')) {
  const service = args.at(-1);
  // Two frontend replicas, the second from another image (#7226).
  if (fail === 'replica-mismatch' && service === 'frontend') console.log('frontend\nfrontend-stale');
  else if (process.env.RELEASE_TEST_REPLICAS === '2' && ['server', 'frontend', 'worker'].includes(service)) console.log(`${service}\n${service}-2`);
  else if (service !== 'bank-data-rekey') console.log(service);
}
// One container runs the image sha256:1…; sha256:3… is used by none.
else if (args[0] === 'ps') console.log('container-1');
else if (args[0] === 'images') console.log(`sha256:${'1'.repeat(64)}\nsha256:${'3'.repeat(64)}`);
else if (args[0] === 'inspect') {
  // Docker treats a quoted list of IDs as one nonexistent container.
  if (args.some(arg => arg.includes('\n'))) exit();
  const format = args[2];
  const container = args.at(-1);
  const service = container.replace(/-2$/, '');
  if (format.includes('.Config.Env') && fail === 'replica-env' && container === 'server-2') {
    console.log('UPLOADS_BACKEND=s3');
    process.exit(0);
  }
  // RELEASE_TEST_BUCKET puts the server in S3 mode with that bucket.
  if (format.includes('.Config.Env') && process.env.RELEASE_TEST_BUCKET) {
    console.log(['UPLOADS_BACKEND=s3', `UPLOADS_S3_ENDPOINT=${process.env.RELEASE_TEST_ENDPOINT || 'https://s3.example.test'}`, 'UPLOADS_S3_REGION=test',
      `UPLOADS_S3_BUCKET=${process.env.RELEASE_TEST_BUCKET}`, 'UPLOADS_S3_ACCESS_KEY=key', 'UPLOADS_S3_SECRET_KEY=secret'].join('\n'));
    process.exit(0);
  }
  console.log(format.includes('.State.Running') ? (fail === 'running' || (fail === 'running-sidecar' && args.at(-1) === 'demo-runtime') ? 'true' : 'false') :
    format.includes('.Mounts') ? (fail === 'replica-volume' && container === 'server-2' ? 'other-uploads' : 'test-uploads') :
    // Tag-created containers, and a frontend a rollback created from a digest.
    format.includes('.Config.Image') ? ({ postgres: 'postgres:17.12-alpine3.24@sha256:34261f594522cf41dfcb76aefd42b9d201098b0e6b23c9c68733f169e4218b6f',
      frontend: `ghcr.io/moto-ogs/phoenix-frontend@sha256:${'2'.repeat(64)}` }[service] ?? 'ghcr.io/moto-ogs/phoenix-server:aaaaaaa') :
    args.at(-1) === 'frontend-stale' ? `sha256:${'4'.repeat(64)}` : `sha256:${'1'.repeat(64)}`);
} else if (args[0] === 'image' && args.includes('--format')) console.log(`postgres@sha256:${'1'.repeat(64)}`);
else if (isCompose && args.includes('--services')) console.log(`postgres\nserver\nfrontend\nmigrate${worker ? '\nworker' : ''}${sidecar ? '\ndemo-runtime' : ''}${rekey ? '\nbank-data-rekey' : ''}`);
else if (isCompose && args.includes('--no-interpolate')) console.log(`services:\n  postgres:\n    image: postgres:test${sidecar ? '\n  demo-runtime:\n    image: server:test' : ''}`);
else if (isCompose && args.includes('pg_dumpall')) console.log('CREATE ROLE phoenix_auth;');
else if (isCompose && args.includes('pg_dump')) console.log('database snapshot');
else if (isCompose && call.includes('SELECT (SELECT count(*)')) console.log('0');
// ADR 0203: the restored snapshot holds the data-return table unless a test
// names an older one; the revocation answers how many grants it ended.
else if (isCompose && call.includes("to_regclass('platform.data_return_grants')")) {
  if (fail === 'revoke-data-return') exit();
  console.log(process.env.RELEASE_TEST_DATA_RETURN === 'absent' ? 'f' : 't');
} else if (isCompose && call.includes('UPDATE platform.data_return_grants')) console.log('2');
else if (args.includes('-czf')) {
  const bind = args.find(value => value.startsWith('type=bind,src='));
  const directory = bind.split(',')[1].slice(4);
  writeFileSync(`${directory}/uploads.tar.gz`, 'uploads snapshot');
}
