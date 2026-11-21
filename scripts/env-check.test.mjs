import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

function fixture(t, demoToken) {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-env-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts', 'environments', 'frontend/src/lib', 'backend/cmd', '.github/workflows']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  copyFileSync(new URL('./env-check.sh', import.meta.url), join(root, 'scripts/env-check.sh'));
  // This fixture isolates key synchronization from the separate Compose checker.
  writeFileSync(join(root, 'scripts/check-runtime-env.py'), '');
  writeFileSync(join(root, 'frontend/src/env.js'), '');
  writeFileSync(join(root, 'frontend/src/lib/env-validation.js'), '');
  writeFileSync(join(root, 'docker-compose.example.yml'), '');
  writeFileSync(join(root, '.env.example'), 'SHARED_KEY=fixture\nHUBSPOT_DEMO_TOKEN=\n');
  for (const env of ['demo', 'staging', 'production']) {
    writeFileSync(join(root, `environments/${env}.sops.env`),
      `SHARED_KEY=fixture\n${env === 'demo' && demoToken ? 'HUBSPOT_DEMO_TOKEN=fixture\n' : ''}`);
  }
  return root;
}

function check(root) {
  return spawnSync('bash', [join(root, 'scripts/env-check.sh')], { encoding: 'utf8' });
}

test('demo token may be absent or provisioned only in demo', async t => {
  for (const provisioned of [false, true]) {
    await t.test(String(provisioned), t => {
      const result = check(fixture(t, provisioned));
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
  }
});

test('HubSpot token is rejected outside demo', t => {
  const root = fixture(t, true);
  writeFileSync(join(root, 'environments/staging.sops.env'), 'SHARED_KEY=fixture\nHUBSPOT_DEMO_TOKEN=fixture\n');
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /staging: HUBSPOT_DEMO_TOKEN is only allowed in demo/);
});

test('other SOPS key mismatches still fail', t => {
  const root = fixture(t, true);
  writeFileSync(join(root, 'environments/production.sops.env'), 'DIFFERENT_KEY=fixture\n');
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /production is missing keys/);
});
