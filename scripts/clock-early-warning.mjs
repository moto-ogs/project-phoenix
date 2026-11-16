#!/usr/bin/env node
// Results of a test suite at moved clocks: the backend suite at moved Go
// clocks (#4027) and the frontend Vitest suite at moved test clocks (#7296).
//
//   node scripts/clock-early-warning.mjs summarize DIR [--suite frontend]
//   GITHUB_REPOSITORY=… GITHUB_TOKEN=… RUN_URL=… \
//     node scripts/clock-early-warning.mjs report DIR [--suite frontend] [--dry-run]
//
// DIR is the output directory of scripts/test-backend-clocks.sh or
// scripts/test-frontend-clocks.sh: times.tsv and one gotestsum or Vitest
// JSON file per time. summarize prints a Markdown table and
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

// One issue per suite: the two are repaired by different means.
export const SUITES = {
  backend: {
    title: TITLE,
    filePrefix: 'go-test',
    heading: 'Backend-Tests mit verstellter Uhr',
    reproduce: 'Go- und PostgreSQL-Uhr laufen auf der genannten Zeit, Dateizeiten nicht. ' +
      'Nachstellen mit `scripts/fake-clock-postgres.sh` und `scripts/fake-clock.sh` (Anleitung im Kopf beider Skripte).',
    issueIntro: [
      'Der wöchentliche Frühwarn-Lauf (`.github/workflows/clock-early-warning.yml`) hat die Backend-Suite mit vorgestellter Go-Uhr ausgeführt. ' +
        'Die Tests unten brechen an diesen Tagen, wenn niemand sie vorher repariert.',
      'Repariere die Ursache (feste Daten, eingespeiste Uhr; `.claude/rules/backend-conventions.md` Regel 14), nicht die Erwartung. ' +
        'Der Lauf schließt dieses Issue nicht; schließe es, wenn die Tests an den genannten Zeiten grün sind. Hintergrund: #4027.',
    ],
  },
  frontend: {
    title: 'Zeitabhängige Frontend-Tests: Frühwarn-Lauf mit verstellter Uhr ist rot',
    filePrefix: 'vitest',
    heading: 'Frontend-Tests mit verstellter Uhr',
    reproduce: 'Jeder Vitest-Test startet auf der genannten Zeit statt auf `TEST_CLOCK_INSTANT`. Nachstellen aus `frontend/`: ' +
      '`FAKE_CLOCK_TIMES=<Zeit> ../scripts/test-frontend-clocks.sh <Ordner> <Testdatei>`.',
    issueIntro: [
      'Der wöchentliche Frühwarn-Lauf (`.github/workflows/clock-early-warning.yml`) hat die Vitest-Suite des Frontends mit verschobener Testuhr ausgeführt. ' +
        'Die Tests unten setzen einen bestimmten Tag voraus, oder der Code unter Test bricht an diesem Tag.',
      'Repariere die Ursache, nicht die Erwartung (`docs/agents/frontend-testing.md`, Abschnitt „Moved clock“). ' +
        'Der Lauf schließt dieses Issue nicht; schließe es, wenn die Tests an den genannten Zeiten grün sind. Hintergrund: #7296.',
    ],
  },
};
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
export function failures(jsonText, suite = 'backend') {
  if (suite === 'frontend') return vitestFailures(jsonText);
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

// Failed tests of one Vitest JSON report. A file that fails without a failed
// test failed to load or in a hook.
function vitestFailures(jsonText) {
  const failed = [];
  for (const file of JSON.parse(jsonText).testResults ?? []) {
    if (file.status === 'passed') continue;
    const name = file.name.replace(/^.*\/frontend\//, '');
    const tests = file.assertionResults.filter(test => test.status === 'failed');
    if (tests.length === 0) failed.push(`${name} (Datei)`);
    for (const test of tests) failed.push(`${name} > ${test.fullName}`);
  }
  return [...new Set(failed)].sort();
}

export function collect(dir, suite = 'backend') {
  return readTimes(dir).map(({ at, reason }) => {
    const path = join(dir, `${SUITES[suite].filePrefix}-${at.replaceAll(':', '')}.json`);
    if (!existsSync(path)) return { at, reason, ran: false, failed: [] };
    return { at, reason, ran: true, failed: failures(readFileSync(path, 'utf8'), suite) };
  });
}

export function isRed(results) {
  return results.length === 0 || results.some(result => !result.ran || result.failed.length > 0);
}

export function renderSummary(results, suite = 'backend') {
  const lines = [`### ${SUITES[suite].heading}`, ''];
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
  lines.push('', SUITES[suite].reproduce);
  return lines.join('\n');
}

export function issueBody(summary, runUrl, suite = 'backend') {
  return [...SUITES[suite].issueIntro, '', `Lauf: ${runUrl}`, '', summary].join('\n');
}

async function openIssue(api, repo, title) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const issues = await api.get(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100&page=${page}`);
    const found = issues.find(issue => !issue.pull_request && issue.title === title);
    if (found || issues.length < 100) return found ?? null;
  }
  return null;
}

export async function report(env, api, dir, { dryRun = false, suite = 'backend' } = {}) {
  const { title } = SUITES[suite];
  const repo = env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const results = collect(dir, suite);
  if (!isRed(results)) return { action: 'none' };
  const summary = renderSummary(results, suite);
  const runUrl = env.RUN_URL ?? '(unbekannt)';
  const existing = await openIssue(api, repo, title);
  const comment = `Lauf: ${runUrl}\n\n${summary}`;
  if (dryRun) {
    console.log(existing
      ? `Dry-run: würde #${existing.number} kommentieren:\n\n${comment}`
      : `Dry-run: würde ein Issue „${title}“ öffnen:\n\n${issueBody(summary, runUrl, suite)}`);
    return { action: existing ? 'comment (dry-run)' : 'create (dry-run)' };
  }
  if (existing) {
    await api.send('POST', `/repos/${repo}/issues/${existing.number}/comments`, { body: comment });
    console.log(`Kommentar an #${existing.number}`);
    return { action: 'comment' };
  }
  const created = await api.send('POST', `/repos/${repo}/issues`, {
    title, body: issueBody(summary, runUrl, suite), labels: [LABEL, 'needs-triage'],
  });
  console.log(`Issue #${created.number} geöffnet`);
  return { action: 'create' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir, ...flags] = process.argv.slice(2);
  const suiteFlag = flags.indexOf('--suite');
  const suite = suiteFlag === -1 ? 'backend' : flags[suiteFlag + 1];
  if (!dir || !['summarize', 'report'].includes(command) || !Object.hasOwn(SUITES, suite ?? '')) {
    console.error('Usage: clock-early-warning.mjs summarize|report DIR [--suite backend|frontend] [--dry-run]');
    process.exit(2);
  }
  if (command === 'summarize') {
    console.log(renderSummary(collect(dir, suite), suite));
  } else {
    const env = process.env;
    await report(env, githubApi({ token: env.GITHUB_TOKEN, baseUrl: env.GITHUB_API_URL }), dir, { dryRun: flags.includes('--dry-run'), suite });
  }
}
