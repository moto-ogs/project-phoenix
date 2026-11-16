// The seed smoke builds its binaries with the seedsmoke tag, which swaps the
// Argon2id profile for the cheap one of the backend tests
// (backend/modules/securityruntime/internal/domain/userpass/seedsmoke_params.go).
// "Warm seed smoke build cache" is the only writer of the build cache those
// jobs restore: other build flags there, and every pull request compiles the
// backend cold without failing anything. And no image may carry the tag.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

// Lines of one job under `jobs:`, up to the next job.
function job(source, name) {
  const lines = source.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `job ${name} exists`);
  let end = start + 1;
  while (end < lines.length && !/^ {2}\S/.test(lines[end]) && !/^\S/.test(lines[end])) end++;
  return lines.slice(start, end).join('\n');
}
// GOFLAGS as the job sees it: job env over workflow env.
function goflags(source, name) {
  const own = job(source, name).match(/^ {4}env:\n((?: {6,}.*\n?)*)/m)?.[1] ?? '';
  const workflow = source.match(/^env:\n((?: {2,}.*\n?)*)/m)?.[1] ?? '';
  const value = text => text.match(/^ +GOFLAGS: (.*)$/m)?.[1];
  return value(own) ?? value(workflow);
}
// Build commands of a job, comments dropped, both spellings of RUNNER_TEMP alike.
const builds = text => [...text.matchAll(/^ +[^#\n]*?\b(go (?:build|test -c) .*)$/gm)].map(match => match[1].replaceAll('${RUNNER_TEMP}', '$RUNNER_TEMP'));

const tests = read('.github/workflows/test.yml');
const warm = read('.github/workflows/backend-build-cache.yml');

test('the cache writer builds the seed smoke binaries with the flags of the smoke job', () => {
  const flags = goflags(tests, 'seed-smoke');
  assert.match(flags, /-tags=\S*\bseedsmoke\b/);
  assert.equal(goflags(warm, 'warm-seed-smoke'), flags);
  const smoke = builds(job(tests, 'seed-smoke'));
  assert.ok(smoke.length >= 3, 'the smoke job builds the server, the dev tools and the coverage ratchet');
  assert.deepEqual(builds(job(warm, 'warm-seed-smoke')).sort(), smoke.sort());
});

test('the smoke server runs under the only APP_ENV the tagged binary accepts', () => {
  assert.match(job(tests, 'seed-smoke'), /^ {6}APP_ENV: development$/m);
  assert.match(read('backend/modules/securityruntime/internal/domain/userpass/seedsmoke_params.go'),
    /^\/\/go:build seedsmoke\n[\s\S]*os\.Getenv\("APP_ENV"\); env != "development"[\s\S]*panic\(/);
});

test('no image, compose file or other workflow builds with the seedsmoke tag', () => {
  const workflows = readdirSync(new URL('.github/workflows/', root)).map(name => `.github/workflows/${name}`);
  const others = [
    'backend/Dockerfile', 'frontend/Dockerfile', 'docker-compose.example.yml',
    ...workflows.filter(path => !/\/(test|backend-build-cache)\.yml$/.test(path)),
  ];
  for (const path of others) assert.doesNotMatch(read(path), /seedsmoke/, path);
  // In the two files that may: only the smoke job and its cache writer.
  for (const [source, name] of [[tests, 'seed-smoke'], [warm, 'warm-seed-smoke']]) {
    assert.doesNotMatch(source.replace(job(source, name), ''), /-tags=\S*seedsmoke/, name);
  }
});
