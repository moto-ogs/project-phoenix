import assert from "node:assert/strict";
import test from "node:test";

import {
  checkStory,
  findingKey,
  orphanedEntries,
  validateExceptions,
  validateKnownViolations,
} from "./kit-touch-targets-lib.mjs";

const small = (target, extra = {}) => ({
  target,
  problem: "small",
  detail: "36 von 97 Punkten treffen nicht",
  clearance24: false,
  ...extra,
});

test("names a finding by problem and target, without the measured detail", () => {
  assert.equal(findingKey(small('tab "Details"')), 'zu klein: tab "Details"');
  assert.equal(
    findingKey({ target: 'button "Weiter"', problem: "overlap", detail: "x" }),
    'überlappt: button "Weiter"',
  );
});

test("a finding not on the list fails the story", () => {
  const result = checkStory({
    story: "components-ui-tabs--default",
    width: "phone",
    findings: [small('tab "Details"')],
    known: {},
    exceptions: [],
  });
  assert.deepEqual(
    result.unexpected.map((f) => f.key),
    ['zu klein: tab "Details"'],
  );
  assert.deepEqual(result.stale, []);
});

test("a known finding passes", () => {
  const result = checkStory({
    story: "components-ui-tabs--default",
    width: "phone",
    findings: [small('tab "Details"')],
    known: {
      "components-ui-tabs--default": { phone: ['zu klein: tab "Details"'] },
    },
    exceptions: [],
  });
  assert.deepEqual(result, { unexpected: [], stale: [] });
});

test("the same target several times carries its count: one more is new", () => {
  const known = {
    "components-ui-chips--default": {
      phone: ['zu klein: button "Entfernen" (2×)'],
    },
  };
  const base = {
    story: "components-ui-chips--default",
    width: "phone",
    known,
    exceptions: [],
  };
  assert.deepEqual(
    checkStory({
      ...base,
      findings: [small('button "Entfernen"'), small('button "Entfernen"')],
    }),
    { unexpected: [], stale: [] },
  );
  const three = checkStory({
    ...base,
    findings: [
      small('button "Entfernen"'),
      small('button "Entfernen"'),
      small('button "Entfernen"'),
    ],
  });
  assert.deepEqual(
    three.unexpected.map((f) => f.key),
    ['zu klein: button "Entfernen" (3×)'],
  );
  assert.deepEqual(three.stale, ['zu klein: button "Entfernen" (2×)']);
});

test("a known entry applies only to its width", () => {
  const result = checkStory({
    story: "components-ui-backlink--default",
    width: "tablet",
    findings: [small('link "Zurück"')],
    known: {
      "components-ui-backlink--default": { phone: ['zu klein: link "Zurück"'] },
    },
    exceptions: [],
  });
  assert.equal(result.unexpected.length, 1);
  assert.deepEqual(result.stale, []);
});

test("a fixed entry is stale: the list only gets shorter", () => {
  const result = checkStory({
    story: "components-ui-tabs--default",
    width: "phone",
    findings: [],
    known: {
      "components-ui-tabs--default": { phone: ['zu klein: tab "Details"'] },
    },
    exceptions: [],
  });
  assert.deepEqual(result.unexpected, []);
  assert.deepEqual(result.stale, ['zu klein: tab "Details"']);
});

test("a kit exception suppresses its finding and is stale once gone", () => {
  const exception = {
    story: "components-ui-stamp--default",
    target: 'button "Kommen"',
    problem: "small",
    kind: "kit-ausnahme",
    reason: "Stempel-Knöpfe der Zeiterfassung (frontend-ui-kit.md)",
  };
  const base = {
    story: "components-ui-stamp--default",
    width: "phone",
    known: {},
    exceptions: [exception],
  };
  assert.deepEqual(
    checkStory({ ...base, findings: [small('button "Kommen"')] }),
    { unexpected: [], stale: [] },
  );
  assert.deepEqual(checkStory({ ...base, findings: [] }).stale, [
    'Ausnahme zu klein: button "Kommen"',
  ]);
});

test("an exception for one width leaves the other width checked", () => {
  const result = checkStory({
    story: "components-ui-stamp--default",
    width: "tablet",
    findings: [small('button "Kommen"')],
    known: {},
    exceptions: [
      {
        story: "components-ui-stamp--default",
        width: "phone",
        target: 'button "Kommen"',
        problem: "small",
        kind: "kit-ausnahme",
        reason: "nur auf dem Telefon",
      },
    ],
  });
  assert.equal(result.unexpected.length, 1);
  assert.deepEqual(result.stale, []);
});

test("the 24 px exception holds only while the element keeps 24 px clearance", () => {
  const exception = {
    story: "components-ui-chip--default",
    target: 'button "Entfernen"',
    problem: "small",
    kind: "abstand-24",
    reason: "44 px sprengten die Zeile der Chips",
  };
  const base = {
    story: "components-ui-chip--default",
    width: "phone",
    known: {},
    exceptions: [exception],
  };
  assert.deepEqual(
    checkStory({
      ...base,
      findings: [small('button "Entfernen"', { clearance24: true })],
    }),
    { unexpected: [], stale: [] },
  );
  const crowded = checkStory({
    ...base,
    findings: [small('button "Entfernen"', { clearance24: false })],
  });
  assert.equal(crowded.unexpected.length, 1);
  assert.match(crowded.unexpected[0].hint, /24 px/);
});

test("an overlap is never covered by the 24 px exception", () => {
  const result = checkStory({
    story: "components-ui-chip--default",
    width: "phone",
    findings: [
      {
        target: 'button "Entfernen"',
        problem: "overlap",
        detail: "x",
        clearance24: true,
      },
    ],
    known: {},
    exceptions: [
      {
        story: "components-ui-chip--default",
        target: 'button "Entfernen"',
        problem: "small",
        kind: "abstand-24",
        reason: "Zeile",
      },
    ],
  });
  assert.equal(result.unexpected.length, 1);
});

test("every exception needs a known kind, a problem and a reason", () => {
  assert.deepEqual(
    validateExceptions([
      {
        story: "a--b",
        target: 'button "X"',
        problem: "small",
        kind: "abstand-24",
        reason: "",
      },
      {
        story: "a--b",
        target: 'button "Y"',
        problem: "small",
        kind: "gefühlt",
        reason: "passt schon",
      },
      {
        story: "a--b",
        target: 'button "Z"',
        problem: "overlap",
        kind: "abstand-24",
        reason: "Zeile",
      },
    ]),
    [
      'Ausnahme a--b › button "X": Begründung fehlt',
      'Ausnahme a--b › button "Y": unbekannte Art "gefühlt" (kit-ausnahme, abstand-24)',
      'Ausnahme a--b › button "Z": abstand-24 gilt nur für zu kleine Flächen, nie für Überlappung',
    ],
  );
});

test("the list of known violations has no unknown width, problem or duplicate", () => {
  assert.deepEqual(
    validateKnownViolations({
      "a--b": {
        phone: ['zu klein: tab "A"', 'zu klein: tab "A"'],
        desktop: ['zu klein: tab "B"'],
        tablet: ['verrutscht: tab "C"'],
      },
      "c--d": { phone: [] },
    }),
    [
      'a--b phone: doppelt: zu klein: tab "A"',
      "a--b: unbekannte Breite desktop (phone, tablet)",
      'a--b tablet: unbekannte Art in verrutscht: tab "C"',
      "c--d phone: leere Liste, Eintrag entfernen",
    ],
  );
});

test("entries for stories missing in the build are reported", () => {
  assert.deepEqual(
    orphanedEntries({
      known: {
        "a--b": { phone: ["zu klein: x"] },
        "gone--x": { phone: ["zu klein: y"] },
      },
      exceptions: [
        {
          story: "old--y",
          target: "x",
          problem: "small",
          kind: "kit-ausnahme",
          reason: "r",
        },
      ],
      storyIds: ["a--b"],
    }),
    ["gone--x", "old--y"],
  );
});
