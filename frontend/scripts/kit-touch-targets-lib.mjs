// Reine Logik der Trefferflächen-Prüfung (#8060): bekannte Verstöße als
// Ratsche, begründete Ausnahmen aus #8059. Die Messung steht in
// kit-touch-targets-measure.ts, der Lauf in kit-touch-targets.pw.ts.

/** Breiten des Laufs im Projekt `phone`: Pixel 7 und iPad hochkant. */
export const TOUCH_WIDTHS = /** @type {const} */ (["phone", "tablet"]);

const PROBLEM_LABEL = /** @type {const} */ ({
  small: "zu klein",
  overlap: "überlappt",
});

/**
 * Arten einer dauerhaften Ausnahme (#8059). Links im Fließtext und
 * Beschriftungen von Textfeldern nimmt die Messung selbst aus; sie stehen
 * nicht in der Liste.
 */
const EXCEPTION_KINDS = /** @type {const} */ ({
  /** Bewusste Ausnahme der Kit-Regel (Stempel-Knöpfe, Pausen-Stepper, Monats-Chips). */
  "kit-ausnahme": "kit-ausnahme",
  /** Mindestens 24 px Abstand rundum, weil 44 px das Layout sprengen. */
  "abstand-24": "abstand-24",
});

/**
 * @typedef {"small" | "overlap"} TouchProblem
 * @typedef {"phone" | "tablet"} TouchWidth
 * @typedef {{ target: string, problem: TouchProblem, detail: string, clearance24?: boolean }} TouchFinding
 * @typedef {Record<string, Partial<Record<string, readonly string[]>>>} KnownViolations
 * @typedef {{ story: string, width?: TouchWidth, target: string, problem: TouchProblem, kind: string, reason: string }} TouchException
 * @typedef {TouchFinding & { key: string, hint?: string }} UnexpectedFinding
 */

/**
 * Eintrag der Liste: Art und Element, ohne Messwert. Der Messwert schwankt
 * mit Text und Breite; der Eintrag soll nur fallen, wenn der Verstoß weg ist.
 *
 * @param {Pick<TouchFinding, "problem" | "target">} finding
 */
export function findingKey(finding) {
  return `${PROBLEM_LABEL[finding.problem]}: ${finding.target}`;
}

/** @param {TouchException} exception */
function exceptionKey(exception) {
  return `Ausnahme ${findingKey(exception)}`;
}

/**
 * Vergleicht die Befunde einer Story in einer Breite mit der Liste.
 * `unexpected`: neue Verstöße. `stale`: Einträge und Ausnahmen, die nichts
 * mehr treffen; sie müssen raus, damit die Liste nur kürzer wird.
 *
 * @param {{ story: string, width: TouchWidth, findings: readonly TouchFinding[], known: KnownViolations, exceptions: readonly TouchException[] }} input
 * @returns {{ unexpected: UnexpectedFinding[], stale: string[] }}
 */
export function checkStory({ story, width, findings, known, exceptions }) {
  const knownKeys = new Set(known[story]?.[width] ?? []);
  const applicable = exceptions.filter(
    (e) => e.story === story && (e.width === undefined || e.width === width),
  );
  const usedKnown = new Set();
  const usedExceptions = new Set();
  /** @type {Map<string, UnexpectedFinding>} */
  const unexpected = new Map();

  for (const finding of findings) {
    const key = findingKey(finding);
    if (knownKeys.has(key)) {
      usedKnown.add(key);
      continue;
    }
    const exception = applicable.find(
      (e) => e.target === finding.target && e.problem === finding.problem,
    );
    if (exception) {
      usedExceptions.add(exception);
      if (exception.kind === "abstand-24" && finding.clearance24 !== true) {
        unexpected.set(key, {
          ...finding,
          key,
          hint: `Ausnahme abstand-24 greift nicht: weniger als 24 px Abstand zum nächsten Bedienelement (${exception.reason})`,
        });
      }
      continue;
    }
    if (!unexpected.has(key)) unexpected.set(key, { ...finding, key });
  }

  return {
    unexpected: [...unexpected.values()],
    stale: [
      ...[...knownKeys].filter((key) => !usedKnown.has(key)),
      ...applicable.filter((e) => !usedExceptions.has(e)).map(exceptionKey),
    ],
  };
}

/**
 * @param {readonly TouchException[]} exceptions
 * @returns {string[]} Fehler, leer wenn alles stimmt
 */
export function validateExceptions(exceptions) {
  const errors = [];
  for (const e of exceptions) {
    const where = `Ausnahme ${e.story} › ${e.target}`;
    if (!(e.kind in EXCEPTION_KINDS)) {
      errors.push(
        `${where}: unbekannte Art "${e.kind}" (${Object.keys(EXCEPTION_KINDS).join(", ")})`,
      );
    } else if (!e.reason?.trim()) {
      errors.push(`${where}: Begründung fehlt`);
    } else if (e.kind === "abstand-24" && e.problem !== "small") {
      errors.push(
        `${where}: abstand-24 gilt nur für zu kleine Flächen, nie für Überlappung`,
      );
    }
    if (e.width !== undefined && !TOUCH_WIDTHS.includes(e.width)) {
      errors.push(`${where}: unbekannte Breite ${e.width}`);
    }
  }
  return errors;
}

/**
 * @param {KnownViolations} known
 * @returns {string[]} Fehler, leer wenn alles stimmt
 */
export function validateKnownViolations(known) {
  const prefixes = Object.values(PROBLEM_LABEL).map((label) => `${label}: `);
  const errors = [];
  for (const [story, byWidth] of Object.entries(known)) {
    for (const [width, keys = []] of Object.entries(byWidth)) {
      if (!TOUCH_WIDTHS.includes(/** @type {TouchWidth} */ (width))) {
        errors.push(
          `${story}: unbekannte Breite ${width} (${TOUCH_WIDTHS.join(", ")})`,
        );
        continue;
      }
      if (keys.length === 0) {
        errors.push(`${story} ${width}: leere Liste, Eintrag entfernen`);
      }
      const seen = new Set();
      for (const key of keys) {
        if (seen.has(key)) errors.push(`${story} ${width}: doppelt: ${key}`);
        seen.add(key);
        if (!prefixes.some((prefix) => key.startsWith(prefix))) {
          errors.push(`${story} ${width}: unbekannte Art in ${key}`);
        }
      }
    }
  }
  return errors;
}

/**
 * Story-ids aus Liste und Ausnahmen, die der Build nicht mehr hat
 * (gelöscht oder umbenannt). Nur sinnvoll ohne Filter.
 *
 * @param {{ known: KnownViolations, exceptions: readonly TouchException[], storyIds: readonly string[] }} input
 */
export function orphanedEntries({ known, exceptions, storyIds }) {
  const current = new Set(storyIds);
  const referenced = new Set([
    ...Object.keys(known),
    ...exceptions.map((e) => e.story),
  ]);
  return [...referenced].filter((id) => !current.has(id)).sort();
}
