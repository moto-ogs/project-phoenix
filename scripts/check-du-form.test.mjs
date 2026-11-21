import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { checkRepository, checkTokens, findFormalAddress, goTokens, scriptTokens, templateTokens } from './check-du-form.mjs';

const words = text => findFormalAddress(text).map(hit => hit.word);

describe('findFormalAddress', () => {
  test('reports the formal address inside a sentence', () => {
    assert.deepEqual(words('Bitte prüfen Sie die Angaben.'), ['Sie']);
    assert.deepEqual(words('Können Sie das bestätigen?'), ['Sie']);
    assert.deepEqual(words('Wenn Sie Fragen haben, melden Sie sich.'), ['Sie', 'Sie']);
    assert.deepEqual(words('Die Schule nutzt Ihre E-Mail-Adresse.'), ['Ihre']);
    for (const word of ['Ihr', 'Ihre', 'Ihrem', 'Ihren', 'Ihrer', 'Ihres']) {
      assert.deepEqual(words(`Wir prüfen ${word} Anliegen.`), [word]);
    }
    assert.deepEqual(words('Hallo {{.Name}}, Ihr Kind ist angemeldet.'), ['Ihr']);
  });

  test('reports „Ihnen“ also at the start of a sentence', () => {
    assert.deepEqual(words('Ihnen wurde ein Code geschickt.'), ['Ihnen']);
    assert.deepEqual(words('Wir senden Ihnen den Link.'), ['Ihnen']);
  });

  test('passes „Sie“ and „Ihr“ at the start of a sentence', () => {
    assert.deepEqual(words('Sie lässt sich nicht ändern.'), []);
    assert.deepEqual(words('Der Antrag geht an die Leitung. Sie entscheidet.'), []);
    assert.deepEqual(words('Gilt das? Ihr müsst nichts tun!'), []);
    assert.deepEqual(words('Hinweis: Sie bleibt bestehen; Ihre Daten auch.'), []);
    assert.deepEqual(words('(Sie bleibt bestehen.)'), []);
    assert.deepEqual(words('<p>Sie gilt ab morgen.</p>'), []);
    assert.deepEqual(words('Erster Absatz\n\nSie gilt ab morgen.'), []);
    // A placeholder may hold a whole sentence.
    assert.deepEqual(words('{} Sie steht in den Einstellungen.'), []);
    assert.deepEqual(words('Verwendungszweck: %s. Ihr müsst nichts überweisen.'), []);
  });

  test('keeps the sentence open after abbreviations, inline tags and single newlines', () => {
    assert.deepEqual(words('Das gilt z. B. Ihre Kinder.'), ['Ihre']);
    assert.deepEqual(words('Bitte <strong>prüfen</strong> Sie die Angaben.'), ['Sie']);
    assert.deepEqual(words('Bitte prüfen\n  Sie die Angaben.'), ['Sie']);
  });

  test('passes lower-case forms, other words and quoted text', () => {
    assert.deepEqual(words('Wenn sie kommt, sagt ihr Bescheid. Ihr Kind? Euer Kind.'), []);
    assert.deepEqual(words('Siegfried kommt aus Siegen, Ihrig auch.'), []);
    assert.deepEqual(words('Tippe auf „Ihre Daten“ oder »Senden Sie«.'), []);
    assert.deepEqual(words('Der Button heißt „Prüfen Sie" und bleibt.'), []);
  });
});

const check = (source, tokenize) => checkTokens(source, tokenize(source));

describe('Go strings', () => {
  test('reads interpreted and raw strings, not comments', () => {
    const source = [
      'package x',
      '// Bitte prüfen Sie den Kommentar.',
      '/* Ihnen auch nicht. */',
      'var a = "Bitte prüfen Sie die Angaben."',
      'var b = `Wir senden',
      'Ihnen den Link.`',
      "var c = 'S'",
      'var d = "Sie lässt sich nicht ändern. \\"Zitat\\""',
    ].join('\n');
    const { findings } = check(source, goTokens);
    assert.deepEqual(findings.map(finding => [finding.line, finding.word]), [[4, 'Sie'], [6, 'Ihnen']]);
  });

  test('a marker covers its expression and nothing after it', () => {
    const source = [
      'func notice() []string {',
      '\t// sie-anrede-erlaubt (ADR 0294): gesetzlicher Wortlaut',
      '\treturn []string{',
      '\t\t"Um Ihr Widerrufsrecht auszuüben, müssen Sie " +',
      '\t\t\t"uns informieren.",',
      '\t}',
      '}',
      'var other = "Bitte prüfen Sie das."',
      'var trailing = "Mit Ihrem Namen." // sie-anrede-erlaubt (ADR 0294): versioniert',
      'var label =',
      '\t// sie-anrede-erlaubt (ADR 0294): Standardhinweis',
      '\t"Die Schule nutzt Ihre Adresse."',
    ].join('\n');
    const { findings, staleMarkers } = check(source, goTokens);
    assert.deepEqual(findings.map(finding => [finding.line, finding.word]), [[8, 'Sie']]);
    assert.deepEqual(staleMarkers, []);
  });

  test('a marker without a hit is stale', () => {
    const source = '// sie-anrede-erlaubt (ADR 0294): alt\nvar a = "Bitte prüfe das."\n';
    assert.deepEqual(check(source, goTokens).staleMarkers, [1]);
  });

  test('a marker needs a reason', () => {
    const source = '// sie-anrede-erlaubt (ADR 0294):\nvar a = "Bitte prüfen Sie das."\n';
    assert.equal(check(source, goTokens).findings.length, 1);
  });
});

describe('TypeScript and TSX', () => {
  test('reads strings, template literals and JSX text, not comments', () => {
    const source = [
      '// Bitte prüfen Sie den Kommentar.',
      'const a = "Bitte prüfen Sie die Angaben.";',
      'const b = `Hallo ${name}, Ihr Kind ist da.`;',
      'const c = `${x ? "Wir senden Ihnen" : ""} den Link`;',
      'const re = /[\'"]/g;',
      'export function View() {',
      '  return (',
      '    <p title="ok">',
      '      Gibt\'s Fragen? Dann melden Sie sich.',
      '      {/* Ihnen nicht */}',
      '    </p>',
      '  );',
      '}',
    ].join('\n');
    const { findings } = check(source, scriptTokens);
    assert.deepEqual(findings.map(finding => [finding.line, finding.word]), [[2, 'Sie'], [3, 'Ihr'], [4, 'Ihnen'], [9, 'Sie']]);
  });

  test('a placeholder before „Sie“ counts as the end of a sentence', () => {
    const source = 'const hint = `${done ? "Erledigt." : "Offen."} Sie steht in den Einstellungen.`;';
    assert.deepEqual(check(source, scriptTokens).findings, []);
  });

  test('a JSX comment marker covers the element below it', () => {
    const source = [
      '<figure>',
      '  {/* sie-anrede-erlaubt (ADR 0294): gesetzlicher Wortlaut */}',
      '  <blockquote className="x">',
      '    Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (',
      '    <span>{name}</span>',
      '    ) informieren.',
      '  </blockquote>',
      '  <p>Bitte prüfen Sie das.</p>',
      '</figure>',
    ].join('\n');
    const { findings, staleMarkers } = check(source, scriptTokens);
    assert.deepEqual(findings.map(finding => [finding.line, finding.word]), [[8, 'Sie']]);
    assert.deepEqual(staleMarkers, []);
  });

  test('a marker above a property covers its value on the next line', () => {
    const source = [
      'const blocks = [{',
      '  // sie-anrede-erlaubt (ADR 0294): Standardhinweis',
      '  label:',
      '    "Die Schule nutzt Ihre E-Mail-Adresse.",',
      '  text: "Bitte prüfen Sie das.",',
      '}];',
    ].join('\n');
    assert.deepEqual(check(source, scriptTokens).findings.map(finding => finding.line), [5]);
  });
});

test('e-mail templates are text without their comments', () => {
  const source = [
    '{{/* Ihnen nicht */}}<!-- Sie auch nicht -->',
    '<p>Hallo {{.Name}},</p>',
    '<p>bitte bestätigen Sie den Link.</p>',
    '<!-- sie-anrede-erlaubt (ADR 0294): Zitat einer Vorlage -->',
    '<blockquote>',
    '  Wir senden Ihnen den Vertrag.',
    '</blockquote>',
    '<p>Wir senden Ihnen den Link.</p>',
  ].join('\n');
  const { findings, staleMarkers } = check(source, templateTokens);
  assert.deepEqual(findings.map(finding => [finding.line, finding.word]), [[3, 'Sie'], [8, 'Ihnen']]);
  assert.deepEqual(staleMarkers, []);
});

test('an escaped line break keeps the hit on the line of its literal', () => {
  const source = 'package x\nvar a = "Hallo.\\nBitte prüfen Sie das."\n';
  assert.deepEqual(check(source, goTokens).findings.map(finding => finding.line), [2]);
});

test('a raw Go string inside a marked block is covered to its end', () => {
  const source = [
    '\t// sie-anrede-erlaubt (ADR 0294): gesetzlicher Wortlaut',
    '\tnotice := []string{',
    '\t\t`Erster Absatz.',
    'Wir erstatten Ihnen alles.`,',
    '\t\t"Haben Sie verlangt, dass …",',
    '\t}',
    '\tother := "Bitte prüfen Sie das."',
  ].join('\n');
  assert.deepEqual(check(source, goTokens).findings.map(finding => finding.line), [7]);
});

describe('checkRepository', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-du-form-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  write('frontend/src/i18n/messages/de/form.json', JSON.stringify({ a: { b: 'Bitte prüfen Sie das.' }, bound: 'Mit Ihrem Namen.', ok: 'Prüfe das.' }));
  write('frontend/src/i18n/messages/en/form.json', JSON.stringify({ a: 'Sie Ihnen' }));
  write('frontend/src/components/a.tsx', 'export const A = () => <p>Bitte geben Sie Ihrem Kind etwas mit.</p>;');
  write('frontend/src/components/a.stories.tsx', 'export const S = { args: { title: "Wir senden Ihnen den Link." } };');
  write('frontend/src/components/a.test.tsx', 'expect("Bitte prüfen Sie das.").toBe(1);');
  write('frontend/src/i18n/messages/de.generated.ts', 'export const x = "Bitte prüfen Sie das.";');
  write('backend/modules/x/text.go', 'package x\nvar a = "Bitte prüfen Sie das."\n');
  write('backend/modules/x/text_test.go', 'package x\nvar a = "Bitte prüfen Sie das."\n');
  write('backend/modules/x/testdata/a.go', 'package x\nvar a = "Bitte prüfen Sie das."\n');
  write('backend/internal/devtools/seed.go', 'package seed\nvar a = "Liebe Eltern, bitte geben Sie Ihrem Kind etwas mit."\n');
  write('backend/templates/email/invite.html', '<p>Bitte bestätigen Sie den Link.</p>');

  test('reports every scanned kind and skips tests, generated files, other locales and demo data', () => {
    const exceptions = [{ file: 'frontend/src/i18n/messages/de/form.json', key: 'bound', reason: 'versioniert' }];
    const problems = checkRepository(root, exceptions);
    assert.deepEqual(problems.map(problem => problem.split(':')[0].split(' ')[0]), [
      'backend/modules/x/text.go',
      'backend/templates/email/invite.html',
      'frontend/src/components/a.stories.tsx',
      'frontend/src/components/a.tsx',
      'frontend/src/components/a.tsx',
      'frontend/src/i18n/messages/de/form.json',
    ]);
    assert.match(problems.at(-1), /form\.json a\.b: „Sie“/);
  });

  test('a JSON exception without a hit fails', () => {
    const problems = checkRepository(root, [
      { file: 'frontend/src/i18n/messages/de/form.json', key: 'bound', reason: 'versioniert' },
      { file: 'frontend/src/i18n/messages/de/form.json', key: 'ok', reason: 'veraltet' },
    ]);
    assert.ok(problems.some(problem => problem.includes('form.json ok: Ausnahme in JSON_EXCEPTIONS deckt keinen Sie-Text mehr ab')));
  });
});
