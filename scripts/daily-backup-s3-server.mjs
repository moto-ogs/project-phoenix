import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
// The image release-backup.sh copies buckets with. CI's apt rclone predates
// `serve s3`, so the test endpoint runs from the same pin.
const rcloneImage = readFileSync(join(scripts, 'release-backup.sh'), 'utf8').match(/^rclone_image=(\S+)$/m)[1];

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  }).on('error', reject);
});

// s3Server serves a directory as S3 on loopback: each folder under buckets
// is a bucket. Callers write with put/remove and read the files back.
export async function s3Server(t, buckets, names) {
  const port = await freePort();
  const key = randomBytes(12).toString('hex');
  const secret = randomBytes(24).toString('hex');
  const endpoint = `http://127.0.0.1:${port}`;
  for (const name of names) mkdirSync(join(buckets, name), { recursive: true });
  const container = `moto-s3-${process.pid}-${port}`;
  t.after(() => spawnSync('docker', ['rm', '-f', container]));
  const started = spawnSync('docker', ['run', '-d', '--name', container, '--user', `${process.getuid()}:${process.getgid()}`,
    '-p', `127.0.0.1:${port}:8080`, '-v', `${buckets}:/data`, rcloneImage,
    'serve', 's3', '--addr', ':8080', '--auth-key', `${key},${secret}`, '/data'], { encoding: 'utf8' });
  assert.equal(started.status, 0, 'local S3 endpoint did not start');
  // A client like the app's: write objects through S3, not the directory,
  // because the server caches its listings.
  const client = (args, input) => spawnSync('docker', ['run', '--rm', '-i', '--network', 'host',
    '-e', 'RCLONE_CONFIG_S3_TYPE=s3', '-e', 'RCLONE_CONFIG_S3_PROVIDER=Other',
    '-e', `RCLONE_CONFIG_S3_ENDPOINT=${endpoint}`, '-e', `RCLONE_CONFIG_S3_ACCESS_KEY_ID=${key}`,
    '-e', `RCLONE_CONFIG_S3_SECRET_ACCESS_KEY=${secret}`, rcloneImage, '--config', '/dev/null', ...args], { input });
  for (let attempt = 0; client(['lsf', `s3:${names[0]}`]).status !== 0; attempt++) {
    assert(attempt < 50, 'local S3 endpoint did not answer');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const put = (bucket, name, content) =>
    assert.equal(client(['rcat', `s3:${bucket}/${name}`], content).status, 0, `put ${name}`);
  const remove = (bucket, name) =>
    assert.equal(client(['deletefile', `s3:${bucket}/${name}`]).status, 0, `remove ${name}`);
  // The app's settings for one bucket, as the deployed .env carries them.
  const settings = (bucket, values = {}) => ({ UPLOADS_BACKEND: 's3', UPLOADS_S3_ENDPOINT: endpoint,
    UPLOADS_S3_REGION: 'local', UPLOADS_S3_BUCKET: bucket, UPLOADS_S3_ACCESS_KEY: key,
    UPLOADS_S3_SECRET_KEY: secret, ...values });
  return { endpoint, key, secret, settings, put, remove };
}

export const dotEnv = values => Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join('');

// Every object under a bucket directory with its bytes, sorted by key.
export const objects = directory => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => relative(directory, join(entry.parentPath, entry.name)))
  .sort()
  .map(name => [name, readFileSync(join(directory, name)).toString('hex')]);
