import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const scripts = dirname(fileURLToPath(import.meta.url));

// dailyBackupRig builds what every daily backup test needs: a private
// workspace and Compose project, the backup environment, the guarded
// transport and the age identity. The caller starts the services it needs.
export function dailyBackupRig(t) {
  const root = mkdtempSync(join(tmpdir(), 'moto-daily-test-'));
  const project = `moto-daily-${process.pid}-${Date.now()}`;
  const volume = `${project}-uploads`;
  const restoredVolume = `${project}-restored`;
  const remote = join(root, 'remote'); mkdirSync(remote);
  const work = join(root, 'work'); mkdirSync(work);
  const marker = randomBytes(24).toString('hex');
  const credential = randomBytes(24).toString('hex');
  const compose = join(root, 'compose.yml');
  const ledger = join(root, 'erasure-ledger');
  writeFileSync(ledger, 'moto-erasure-ledger-v1\n', { mode: 0o600 });
  writeFileSync(join(root, '.env'), `PRIVATE_MARKER=${credential}\nPOSTGRES_PASSWORD=${credential}\n`);
  writeFileSync(compose, `services:
  postgres:
    image: postgres:17.12-alpine3.24@sha256:34261f594522cf41dfcb76aefd42b9d201098b0e6b23c9c68733f169e4218b6f
    network_mode: none
    environment:
      POSTGRES_PASSWORD: ${credential}
      POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256
    volumes: [database:/var/lib/postgresql/data]
    healthcheck:
      test: [CMD, pg_isready, -h, 127.0.0.1, -U, postgres]
      interval: 1s
      retries: 60
  server:
    image: postgres:17.12-alpine3.24@sha256:34261f594522cf41dfcb76aefd42b9d201098b0e6b23c9c68733f169e4218b6f
    network_mode: none
    entrypoint: [sleep, infinity]
volumes:
  database:
`);
  const env = { ...process.env, BACKUP_COMPOSE_FILE: compose, BACKUP_PROJECT: project,
    BACKUP_UPLOADS_VOLUME: volume, BACKUP_TRANSPORT: 'local', BACKUP_TARGET: remote,
    BACKUP_WORK_DIR: work, BACKUP_CIPHER_DIR: join(root, 'cipher'),
    BACKUP_MIN_FREE_BYTES: '1048576', BACKUP_RETENTION_DAYS: '30',
    POSTGRES_PASSWORD: credential, PHOENIX_AUTH_PASSWORD: randomBytes(24).toString('hex'),
    PHOENIX_DEMO_PASSWORD: randomBytes(24).toString('hex') };
  mkdirSync(env.BACKUP_CIPHER_DIR);
  for (const key of ['COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES']) delete env[key];
  const invoke = (command, args, input, overrides = {}) => spawnSync(command, args,
    { cwd: root, env: { ...env, ...overrides }, input, encoding: 'utf8', timeout: 180000 });
  const run = (command, args, input, overrides) => {
    const result = invoke(command, args, input, overrides);
    const diagnostic = command === 'docker' && args.includes('up')
      ? result.stderr.replaceAll(credential, '[redacted]').replaceAll(marker, '[redacted]') : 'diagnostics withheld';
    assert.equal(result.status, 0, `${command} failed: ${diagnostic}`);
    return result.stdout.trim();
  };
  const docker = (...args) => run('docker', args);
  const dc = (...args) => docker('compose', '--env-file', join(root, '.env'), '-f', compose, '-p', project, ...args);
  const databaseSQL = (database, query) => run('docker', ['compose', '--env-file', join(root, '.env'), '-f', compose, '-p', project,
    'exec', '-T', 'postgres', 'psql', '-X', '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'], query);
  const sql = query => databaseSQL('postgres', query);
  // Main recovery above still destroys the actual volume. For the expanded
  // role matrix, reset this private cluster's DB and non-system roles instead
  // of restarting initdb for every source and target. Restore's real fresh-target guards still run.
  // One psql session: it sends the statements one by one, so DROP DATABASE
  // runs outside a transaction, and the matrix pays one exec instead of three.
  const resetCluster = () => databaseSQL('template1', `DROP DATABASE postgres WITH (FORCE);
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> 'postgres' LOOP
    EXECUTE format('DROP ROLE %I', r.rolname);
  END LOOP;
END $$;
CREATE DATABASE postgres TEMPLATE template0;`);
  const backup = (overrides = {}) => invoke('bash', [join(scripts, 'daily-backup.sh')], undefined, overrides);
  const restore = (name, overrides = {}) => invoke('bash', [join(scripts, 'restore-daily-backup.sh'), name, ledger], undefined,
    { BACKUP_UPLOADS_VOLUME: restoredVolume, BACKUP_AGE_IDENTITY_FILE: join(root, 'identity'), ...overrides });
  t.after(() => {
    invoke('docker', ['compose', '-f', compose, '-p', project, 'down', '-v', '--remove-orphans']);
    invoke('docker', ['volume', 'rm', volume, restoredVolume, `${project}-rejected`]);
    rmSync(root, { recursive: true, force: true });
  });
  // Observe the real transport boundary: ciphertext never occupies the
  // plaintext workspace, and backup must not materialize an outer tar there.
  const guardedBin = join(root, 'guarded-bin'); mkdirSync(guardedBin);
  const transport = run('which', ['rclone']);
  writeFileSync(join(guardedBin, 'rclone'), `#!/bin/sh
for arg in "$@"; do
  case "$arg" in '${work}'/*.age) exit 29;; esac
done
[ -z "$(find '${work}' -name bundle.tar -print -quit)" ] || exit 30
exec '${transport}' "$@"
`);
  chmodSync(join(guardedBin, 'rclone'), 0o700);
  env.PATH = `${guardedBin}:${env.PATH}`;
  run('age-keygen', ['-o', join(root, 'identity')]);
  env.BACKUP_AGE_RECIPIENT = run('age-keygen', ['-y', join(root, 'identity')]);
  return { root, project, volume, restoredVolume, remote, work, marker, credential, compose, ledger, env, invoke, run, docker, dc, databaseSQL, sql, resetCluster, backup, restore };
}

// roleRestoreMatrix backs up and restores one private cluster per role case
// of the given profiles. Each profile has a test file of its own and they
// run side by side: the 64 cases at the end of the main scenario took about
// 250 of its 295 s (#6962).
export function roleRestoreMatrix(t, rig, labels) {
  const { root, project, volume, restoredVolume, remote, work, marker, credential, compose, ledger, env, invoke, run, docker, dc, databaseSQL, sql, resetCluster, backup, restore } = rig;
  const reviewMarker = join(root, '.daily-restore-review-required');
  dc('up', '-d', '--wait', 'postgres');
  // The uploads a restore of the main scenario leaves behind.
  docker('run', '--rm', '-v', `${restoredVolume}:/uploads`, 'postgres:17.12-alpine3.24@sha256:34261f594522cf41dfcb76aefd42b9d201098b0e6b23c9c68733f169e4218b6f', 'sh', '-c',
    'mkdir -p /uploads/documents/41 /uploads/documents/42; printf first > /uploads/documents/41/file; printf second > /uploads/documents/42/file; printf hidden > /uploads/.hidden');
  // An unrelated or more privileged personal login still blocks recovery.
  // Exercise real globals AND database dumps: direct ACLs/ownership are absent
  // from globals and must be rejected after database_restore as well.
  const unsafeRoles = [
    'CREATE ROLE unrelated LOGIN;',
    'GRANT tenant_scope TO "diagnose synthetic";',
    'ALTER ROLE "diagnose synthetic" SUPERUSER;',
    'ALTER ROLE "diagnose synthetic" BYPASSRLS;',
    'GRANT phoenix_diagnostics TO "diagnose synthetic" WITH ADMIN TRUE;',
    'GRANT phoenix_diagnostics TO "diagnose synthetic" WITH INHERIT TRUE;',
    'GRANT phoenix_diagnostics TO "diagnose synthetic" WITH SET FALSE;',
    'ALTER ROLE "diagnose synthetic" SET search_path = public;',
    'GRANT SELECT ON records TO "diagnose synthetic";',
    'GRANT SELECT (tenant_id) ON records TO "diagnose synthetic";',
    'ALTER TABLE records OWNER TO "diagnose synthetic";',
    'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO "diagnose synthetic";',
    'GRANT pg_monitor TO phoenix_diagnostics;',
  ];
  const profiles = [
    { group: 'phoenix_diagnostics', login: 'diagnose synthetic', label: 'diagnostics' },
    { group: 'phoenix_school_erasure', login: 'erase synthetic', label: 'school_erasure' },
    { group: 'phoenix_billing_retention', login: 'billing synthetic', label: 'billing_retention' },
    { group: 'phoenix_data_return', login: 'return synthetic', label: 'data_return' },
  ];
  let accepted = 0; let rejected = 0; let result;
  const selected = profiles.filter(p => labels.includes(p.label));
  assert.equal(selected.length, labels.length, `unknown role profile in ${labels}`);
  for (const profile of selected) {
    const otherGroup = profile.group === 'phoenix_school_erasure' ? 'phoenix_billing_retention' : 'phoenix_school_erasure';
    const dualMembership = `CREATE ROLE ${otherGroup} NOLOGIN NOINHERIT; GRANT ${otherGroup} TO "diagnose synthetic";`;
    // A reserved group must not masquerade as an otherwise eligible login.
    const groupLogin = `CREATE ROLE ${otherGroup} LOGIN NOINHERIT; GRANT ${profile.group} TO ${otherGroup};`;
    for (const [index, unsafe] of ['', ...unsafeRoles, dualMembership, groupLogin].entries()) {
      resetCluster();
      rmSync(reviewMarker, { force: true });
      const statements = `CREATE ROLE ${profile.group} NOLOGIN NOINHERIT;
CREATE ROLE "diagnose synthetic" LOGIN NOINHERIT;
GRANT ${profile.group} TO "diagnose synthetic";
CREATE ROLE tenant_scope;
CREATE TABLE records(tenant_id bigint);
${unsafe.replaceAll('phoenix_diagnostics', profile.group)}`;
      sql(statements.replaceAll('diagnose synthetic', profile.login));
      const destination = join(root, `${profile.label}-${index}`); mkdirSync(destination);
      result = backup({ BACKUP_UPLOADS_VOLUME: restoredVolume, BACKUP_TARGET: destination });
      assert.equal(result.status, 0, result.stdout);
      const unsafeName = readdirSync(destination).find(n => n.endsWith('.age'));
      resetCluster();
      result = restore(unsafeName, { BACKUP_TARGET: destination, BACKUP_UPLOADS_VOLUME: `${project}-rejected` });
      if (!unsafe) {
        assert.equal(result.status, 0, `safe ${profile.label} login alone must be quarantined`);
        assert.match(result.stdout, /^restore_result=ok step=deletion_review_required app_start=blocked$/m);
        assert.match(result.stdout, new RegExp(`restore_${profile.label}_disabled=1`));
        assert.equal(sql(`SELECT rolcanlogin FROM pg_roles WHERE rolname='${profile.login}';`), 'f');
        assert.equal(sql(`SELECT pg_has_role('${profile.login}', '${profile.group}', 'SET');`), 't');
        docker('volume', 'rm', `${project}-rejected`);
        accepted++;
      } else {
        assert.notEqual(result.status, 0, `unsafe ${profile.label} role case ${index} must fail`);
        assert.equal(result.stdout, 'restore_result=failed step=role_passwords app_start=blocked\n');
        assert.equal(JSON.parse(readFileSync(reviewMarker, 'utf8')).app_start, 'blocked');
        assert.notEqual(invoke('docker', ['volume', 'inspect', `${project}-rejected`]).status, 0);
        rejected++;
      }
      assert(!result.stdout.includes(profile.login));
      assert.equal(result.stderr, '');
    }
  }
  t.diagnostic(`role restore matrix (${labels.join(', ')}): ${accepted} accepted NOLOGIN profiles and ${rejected} rejected profiles`);
  return { accepted, rejected };
}
