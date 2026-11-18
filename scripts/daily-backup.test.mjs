import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const harness = `
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('daily_backup', 'scripts/daily_backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
`;

function python(source) {
  const result = spawnSync('python3', ['-B', '-c', harness + source], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('daily backup selects the serving container store, not pending Compose settings', () => {
  python(`
recovery = backup.Recovery.__new__(backup.Recovery)
recovery.mode = 'backup'
recovery.backup_host = None
recovery.target = '/backup'
recovery.rclone_env = {}
recovery.dc = lambda *args: (b'serving-container' if args[0] == 'ps' else
    json.dumps({'services': {'server': {'environment': {'UPLOADS_BACKEND': 's3',
        'UPLOADS_S3_ENDPOINT': 'https://s3.example.test', 'UPLOADS_S3_REGION': 'test',
        'UPLOADS_S3_BUCKET': 'pending', 'UPLOADS_S3_ACCESS_KEY': 'test',
        'UPLOADS_S3_SECRET_KEY': 'test'}}}}).encode())
with patch.dict(os.environ, {'BACKUP_UPLOADS_VOLUME': 'active-uploads'}, clear=True), \\
     patch.object(backup, 'command', return_value=b'["UPLOADS_BACKEND=local"]') as inspect:
    recovery.configure_uploads()
    assert recovery.uploads == 'local'
    assert recovery.volume == 'active-uploads'
    assert inspect.call_args.args[0] == ['docker', 'inspect', '--format', '{{json .Config.Env}}', 'serving-container']
`);
});

test('daily backup reads serving settings only after acquiring the operation lock', () => {
  python(`
with tempfile.TemporaryDirectory(prefix='moto-daily-lock-') as directory:
    root = Path(directory)
    compose = root / 'compose.yml'
    compose.touch()
    work = root / 'work'
    work.mkdir()
    cipher = root / 'cipher'
    cipher.mkdir()
    lock = root / '.release-operation.lock'
    calls = []
    def dc(self, *args, **kwargs):
        assert lock.is_dir(), 'upload settings were read without the operation lock'
        calls.append(args)
        return b'serving-container'
    env = {'BACKUP_COMPOSE_FILE': str(compose), 'BACKUP_PROJECT': 'test-project',
           'BACKUP_TRANSPORT': 'local', 'BACKUP_TARGET': str(root / 'remote'),
           'BACKUP_UPLOADS_VOLUME': 'active-uploads', 'BACKUP_WORK_DIR': str(work),
           'BACKUP_CIPHER_DIR': str(cipher), 'BACKUP_MIN_FREE_BYTES': '1',
           'BACKUP_RETENTION_DAYS': '1', 'BACKUP_AGE_RECIPIENT': 'age1test'}
    with patch.dict(os.environ, env, clear=True), \\
         patch.object(sys, 'argv', ['daily_backup.py', 'backup']), \\
         patch.object(backup.Recovery, 'dc', dc), \\
         patch.object(backup, 'command', return_value=b'["UPLOADS_BACKEND=local"]'), \\
         patch.object(backup.Recovery, 'backup'):
        assert backup.main() == 0
    assert calls == [('ps', '-a', '-q', 'server')]
    assert not lock.exists()
`);
});

test('daily backup fails closed when the serving container settings cannot be read', () => {
  python(`
for container, environment in [(b'', b'[]'), (b'one\\ntwo', b'[]'),
                               (b'server', b'null'), (b'server', b'[]'),
                               (b'server', RuntimeError('inspect failed'))]:
    recovery = backup.Recovery.__new__(backup.Recovery)
    recovery.mode = 'backup'
    recovery.dc = lambda *args: container
    with patch.dict(os.environ, {'BACKUP_UPLOADS_VOLUME': 'stale-uploads'}, clear=True), \\
         patch.object(backup, 'command', side_effect=environment if isinstance(environment, Exception) else None,
                      return_value=environment):
        try:
            recovery.configure_uploads()
        except (ValueError, RuntimeError):
            pass
        else:
            raise AssertionError('unreadable settings fell back to the stale volume')
`);
});

test('daily S3 restore leaves canned ACLs unset for bucket-owner-enforced targets', () => {
  python(`
recovery = backup.Recovery.__new__(backup.Recovery)
recovery.mode = 'restore'
recovery.backup_host = None
recovery.target = '/backup'
recovery.rclone_env = {}
settings = {'UPLOADS_BACKEND': 's3', 'UPLOADS_S3_ENDPOINT': 'https://s3.example.test',
            'UPLOADS_S3_REGION': 'test', 'UPLOADS_S3_BUCKET': 'uploads',
            'UPLOADS_S3_ACCESS_KEY': 'test', 'UPLOADS_S3_SECRET_KEY': 'test'}
with patch.dict(os.environ, settings, clear=True):
    recovery.configure_uploads()
assert not recovery.rclone_env.get('RCLONE_CONFIG_UPLOADS_ACL')
`);
});
