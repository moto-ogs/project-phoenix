#!/usr/bin/env node
// Results of the backend suite at moved Go clocks (#4027).
//
//   node scripts/clock-early-warning.mjs summarize DIR
//   GITHUB_REPOSITORY=… GITHUB_TOKEN=… RUN_URL=… \
//     node scripts/clock-early-warning.mjs report DIR [--dry-run]
//
// DIR is the output directory of scripts/test-backend-clocks.sh: times.tsv
// and one gotestsum JSON file per time. summarize prints a Markdown table and
// the failed tests per time. report runs in clock-early-warning.yml after a
// red run: it opens one issue, or comments on the open one, so a test that
// will fail on a coming day is known before that day. It never closes the
// issue; whoever fixes the tests closes it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubApi } from '../.github/actions/ci-cost/ci-cost.mjs';

export const TITLE = 'Zeitabhängige Tests: Frühwarn-Lauf mit verstellter Uhr ist rot';
export const LABEL = 'maintenance';
const MAX_PAGES = 10;
const MAX_LISTED = 40;

export function readTimes(dir) {
  const path = join(dir, 'times.tsv');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => {
    const [at, ...reason] = line.split('\t');
    return { at, reason: reason.join('\t') };
  });
}

// Failed tests of one gotestsum JSON file. A package that fails without a
// failed test failed to build or in TestMain (the leftover gate).
export function failures(jsonText) {
  const tests = [];
  const packages = new Set();
  const withTest = new Set();
  for (const line of jsonText.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.Action !== 'fail' || !event.Package) continue;
    if (event.Test) {
      tests.push(`${event.Package} ${event.Test}`);
      withTest.add(event.Package);
    } else {
      packages.add(event.Package);
    }
  }
  const failedPackages = [...packages].filter(pkg => !withTest.has(pkg)).map(pkg => `${pkg} (Paket)`);
  // A parent test fails with each failing subtest; list the deepest only.
  const leaves = tests.filter(test => !tests.some(other => other.startsWith(`${test}/`)));
  return [...new Set([...leaves, ...failedPackages])].sort();
}

export function collect(dir) {
  return readTimes(dir).map(({ at, reason }) => {
    const path = join(dir, `go-test-${at.replaceAll(':', '')}.json`);
    if (!existsSync(path)) return { at, reason, ran: false, failed: [] };
    return { at, reason, ran: true, failed: failures(readFileSync(path, 'utf8')) };
  });
}

export function isRed(results) {
  return results.length === 0 || results.some(result => !result.ran || result.failed.length > 0);
}

export function renderSummary(results) {
  const lines = ['### Backend-Tests mit verstellter Uhr', ''];
  if (results.length === 0) {
    lines.push('Keine Ergebnisse: Der Lauf endete vor der ersten Zeit.');
    return lines.join('\n');
  }
  lines.push('| Zeit (Berlin) | Anlass | Ergebnis |', '|---|---|---|');
  for (const { at, reason, ran, failed } of results) {
    const outcome = !ran ? 'kein Ergebnis' : failed.length === 0 ? 'grün' : `${failed.length} rot`;
    lines.push(`| ${at} | ${reason} | ${outcome} |`);
  }
  for (const { at, reason, failed } of results.filter(result => result.failed.length > 0)) {
    lines.push('', `#### ${at} (${reason})`, '');
    for (const test of failed.slice(0, MAX_LISTED)) lines.push(`- \`${test}\``);
    if (failed.length > MAX_LISTED) lines.push(`- … und ${failed.length - MAX_LISTED} weitere`);
  }
  lines.push('', 'Go- und PostgreSQL-Uhr laufen auf der genannten Zeit, Dateizeiten nicht. ' +
    'Nachstellen mit `scripts/fake-clock-postgres.sh` und `scripts/fake-clock.sh` (Anleitung im Kopf beider Skripte).');
  return lines.join('\n');
}

export function issueBody(summary, runUrl) {
  return [
    'Der wöchentliche Frühwarn-Lauf (`.github/workflows/clock-early-warning.yml`) hat die Backend-Suite mit vorgestellter Go-Uhr ausgeführt. ' +
      'Die Tests unten brechen an diesen Tagen, wenn niemand sie vorher repariert.',
    'Repariere die Ursache (feste Daten, eingespeiste Uhr; `.claude/rules/backend-conventions.md` Regel 14), nicht die Erwartung. ' +
      'Der Lauf schließt dieses Issue nicht; schließe es, wenn die Tests an den genannten Zeiten grün sind. Hintergrund: #4027.',
    '',
    `Lauf: ${runUrl}`,
    '',
    summary,
  ].join('\n');
}

async function openIssue(api, repo) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const issues = await api.get(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100&page=${page}`);
    const found = issues.find(issue => !issue.pull_request && issue.title === TITLE);
    if (found || issues.length < 100) return found ?? null;
  }
  return null;
}

export async function report(env, api, dir, { dryRun = false } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const results = collect(dir);
  if (!isRed(results)) return { action: 'none' };
  const summary = renderSummary(results);
  const runUrl = env.RUN_URL ?? '(unbekannt)';
  const existing = await openIssue(api, repo);
  const comment = `Lauf: ${runUrl}\n\n${summary}`;
  if (dryRun) {
    console.log(existing
      ? `Dry-run: würde #${existing.number} kommentieren:\n\n${comment}`
      : `Dry-run: würde ein Issue „${TITLE}“ öffnen:\n\n${issueBody(summary, runUrl)}`);
    return { action: existing ? 'comment (dry-run)' : 'create (dry-run)' };
  }
  if (existing) {
    await api.send('POST', `/repos/${repo}/issues/${existing.number}/comments`, { body: comment });
    console.log(`Kommentar an #${existing.number}`);
    return { action: 'comment' };
  }
  const created = await api.send('POST', `/repos/${repo}/issues`, {
    title: TITLE, body: issueBody(summary, runUrl), labels: [LABEL, 'needs-triage'],
  });
  console.log(`Issue #${created.number} geöffnet`);
  return { action: 'create' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir, ...flags] = process.argv.slice(2);
  if (!dir || !['summarize', 'report'].includes(command)) {
    console.error('Usage: clock-early-warning.mjs summarize|report DIR [--dry-run]');
    process.exit(2);
  }
  if (command === 'summarize') {
    console.log(renderSummary(collect(dir)));
  } else {
    const env = process.env;
    await report(env, githubApi({ token: env.GITHUB_TOKEN, baseUrl: env.GITHUB_API_URL }), dir, { dryRun: flags.includes('--dry-run') });
  }
}
