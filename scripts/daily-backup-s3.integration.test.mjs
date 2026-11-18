import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { dotEnv, objects, s3Server } from './daily-backup-s3-server.mjs';
import { dailyBackupRig } from './daily-backup-test-rig.mjs';

test('daily backup in S3 mode backs up the bucket the server uses and restores it into a fresh bucket', { timeout: 600000 }, async t => {
  const buckets = mkdtempSync(join(tmpdir(), 'moto-daily-s3-'));
  t.after(() => rmSync(buckets, { recursive: true, force: true }));
  const s3 = await s3Server(t, buckets, ['source', 'restored']);
  const rig = dailyBackupRig(t, { dotEnv: dotEnv(s3.settings('source')) });
  const { root, ledger, run, dc, sql, backup, restore } = rig;
  const source = join(buckets, 'source');
  // Hidden, nested, empty and NFD-named objects must survive byte for byte.
  s3.put('source', 'documents/41/file', 'first');
  s3.put('source', 'documents/41/A\u0308rztliche-Bescheinigung', 'sealed');
  s3.put('source', '.hidden', 'hidden');
  s3.put('source', 'empty', '');
  const expected = objects(source);

  dc('up', '-d', '--wait', 'postgres', 'server');
  sql("CREATE TABLE records(marker text); INSERT INTO records VALUES ('kept');");
  // The backup reads the server's settings; its own environment must not
  // carry upload values that would override the Compose .env.
  let result = backup({ UPLOADS_BACKEND: 's3' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, 'backup_result=failed step=configuration\n');
  // Pending local settings must not hide the active bucket from the backup.
  const settings = readFileSync(join(root, '.env'), 'utf8');
  writeFileSync(join(root, '.env'), settings.replace('UPLOADS_BACKEND=s3', 'UPLOADS_BACKEND=local'));
  // No volume is needed: the serving container still uses the bucket.
  result = backup({ BACKUP_UPLOADS_VOLUME: '' });
  writeFileSync(join(root, '.env'), settings);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.stdout, 'backup_result=ok step=complete\n');
  assert(!result.stderr.includes(s3.secret));
  const name = readdirSync(rig.remote).find(n => n.endsWith('.age'));
  run('age', ['-d', '-i', join(root, 'identity'), '-o', join(root, 'bundle.tar'), join(rig.remote, name)]);
  assert.equal(JSON.parse(run('tar', ['-xOf', join(root, 'bundle.tar'), 'manifest.json'])).uploads, 'bucket');

  // A missing or unknown setting on the server fails closed, naming only the key.
  writeFileSync(join(root, '.env'), settings.replace(/^UPLOADS_S3_BUCKET=.*\n/m, ''));
  dc('up', '-d', '--force-recreate', 'server');
  assert.equal(backup().stdout, 'backup_result=failed step=configuration missing=UPLOADS_S3_BUCKET\n');
  writeFileSync(join(root, '.env'), settings.replace('UPLOADS_BACKEND=s3', 'UPLOADS_BACKEND=bucket'));
  dc('up', '-d', '--force-recreate', 'server');
  assert.equal(backup().stdout, 'backup_result=failed step=configuration\n');
  writeFileSync(join(root, '.env'), settings);

  dc('down', '-v');
  dc('up', '-d', '--wait', 'postgres');
  const marker = join(root, '.daily-restore-review-required');
  const target = { ...s3.settings('restored'), BACKUP_UPLOADS_VOLUME: '' };
  // A bucket bundle never lands in a volume, nor in a bucket that has objects.
  result = restore(name);
  assert.equal(result.stdout, 'restore_result=failed step=fresh_target app_start=blocked\n');
  result = restore(name, { ...target, UPLOADS_S3_BUCKET: 'source' });
  assert.equal(result.stdout, 'restore_result=failed step=fresh_target app_start=blocked\n');
  assert(!existsSync(marker));
  assert.deepEqual(objects(source), expected);
  result = restore(name, { ...target, UPLOADS_S3_SECRET_KEY: '' });
  assert.equal(result.stdout, 'restore_result=failed step=configuration missing=UPLOADS_S3_SECRET_KEY app_start=blocked\n');

  result = restore(name, target);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.stdout, 'restore_result=ok step=deletion_review_required app_start=blocked\n');
  assert.equal(result.stderr, '');
  assert.deepEqual(objects(join(buckets, 'restored')), expected);
  assert.equal(sql('SELECT marker FROM records;'), 'kept');
  assert.equal(JSON.parse(readFileSync(marker, 'utf8')).app_start, 'blocked');
  assert.deepEqual(readdirSync(rig.work), []);
  assert.equal(readFileSync(ledger, 'utf8'), 'moto-erasure-ledger-v1\n');
});
