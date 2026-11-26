/**
 * The editable list of the Träger's criteria (#4700) and how they count
 * (#8135): by their order, all the same, or by points. Also the templates a
 * person can click and the checks before saving. Field
 * names match the backend's `errors[].field` (`criteria.N.name`), so a
 * refusal lands at the same control as a local check.
 */

import {
  type HolidayCriteriaRanking,
  type HolidayCriteriaRead,
  type HolidayCriterion,
  type HolidayCriterionInput,
  type HolidayCriterionScope,
  MAX_CRITERION_NAME,
  MAX_CRITERION_POINTS,
  MAX_CRITERION_QUESTION,
  MAX_HOLIDAY_CRITERIA,
} from "~/lib/traeger-holiday-allocation-api";

export interface CriterionDraft {
  /** Stable React key; never sent. */
  readonly key: string;
  /** Empty for a new criterion. */
  readonly id: string;
  readonly name: string;
  readonly question: string;
  readonly scope: HolidayCriterionScope;
  readonly active: boolean;
  /** The points as typed; they count with the ranking "points" only. */
  readonly points: string;
  /** Parents answered it already: its scope stays. */
  readonly answered: boolean;
}

/** What the editor holds: the list and how it counts. */
export interface CriteriaDraft {
  readonly ranking: HolidayCriteriaRanking;
  readonly items: readonly CriterionDraft[];
}

/**
 * The three ways the criteria count, as the editor offers them. Every one
 * ends at the arrival: who registered first comes first at a tie.
 */
export const CRITERIA_RANKINGS: readonly {
  readonly value: HolidayCriteriaRanking;
  readonly label: string;
  readonly text: string;
}[] = [
  {
    value: "priority",
    label: "Nach Rangfolge",
    text: "Das oberste Kriterium zählt am meisten, dann das nächste.",
  },
  {
    value: "equal",
    label: "Alle gleich",
    text: "Jedes Kriterium zählt gleich viel. Wer mehr erfüllt, steht weiter oben.",
  },
  {
    value: "points",
    label: "Nach Punkten",
    text: "Du gibst jedem Kriterium Punkte. Wer mehr Punkte hat, steht weiter oben.",
  },
];

/** „1 Punkt“, „3 Punkte“. */
export function pointsLabel(points: number): string {
  return points === 1 ? "1 Punkt" : `${points} Punkte`;
}

/** The typed points as a whole number in the limits, else null. */
export function parsePoints(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const points = Number(trimmed);
  return points >= 1 && points <= MAX_CRITERION_POINTS ? points : null;
}

/** One step of minus or plus, kept in the limits; a text that is no number starts at 1. */
export function stepPoints(text: string, delta: -1 | 1): string {
  const points = parsePoints(text);
  if (points === null) return "1";
  return String(Math.min(MAX_CRITERION_POINTS, Math.max(1, points + delta)));
}

/**
 * Suggestions to start from; nothing is fixed. Only yes/no questions the
 * allocation needs: nothing on health or special needs.
 */
export const CRITERION_TEMPLATES: readonly Omit<
  CriterionDraft,
  "key" | "id" | "active" | "answered" | "points"
>[] = [
  {
    name: "Beide Eltern berufstätig",
    question:
      "Sind beide Eltern berufstätig oder ist die alleinerziehende Person berufstätig?",
    scope: "family",
  },
  {
    name: "Alleinerziehend und berufstätig",
    question: "Bist du alleinerziehend und berufstätig?",
    scope: "family",
  },
  {
    name: "Geschwisterkind ist schon angemeldet",
    question:
      "Ist ein Geschwisterkind schon für diese Ferienbetreuung angemeldet?",
    scope: "child",
  },
  {
    name: "Besonderer Härtefall",
    question:
      "Gibt es einen besonderen Härtefall in deiner Familie? Das Büro fragt dann bei dir nach.",
    scope: "family",
  },
];

let keySequence = 0;
function nextKey(): string {
  keySequence += 1;
  return `criterion-${keySequence}`;
}

export function draftsFromCriteria(
  criteria: readonly HolidayCriterion[],
): CriterionDraft[] {
  return [...criteria]
    .sort((a, b) => a.position - b.position)
    .map((criterion) => ({
      key: nextKey(),
      id: criterion.id,
      name: criterion.name,
      question: criterion.question,
      scope: criterion.scope,
      active: criterion.active,
      points: String(criterion.points),
      answered: criterion.answered,
    }));
}

export function draftFromRead(stored: HolidayCriteriaRead): CriteriaDraft {
  return {
    ranking: stored.ranking,
    items: draftsFromCriteria(stored.criteria),
  };
}

export function emptyCriterion(): CriterionDraft {
  return {
    key: nextKey(),
    id: "",
    name: "",
    question: "",
    scope: "family",
    active: true,
    points: "1",
    answered: false,
  };
}

/** A template is used when a criterion with its name is in the list. */
export function templateUsed(
  drafts: readonly CriterionDraft[],
  name: string,
): boolean {
  const wanted = name.trim().toLowerCase();
  return drafts.some((draft) => draft.name.trim().toLowerCase() === wanted);
}

export function fromTemplate(
  template: (typeof CRITERION_TEMPLATES)[number],
): CriterionDraft {
  return { ...emptyCriterion(), ...template };
}

/** Moves one criterion up (-1) or down (+1); outside the list nothing moves. */
export function moveCriterion(
  drafts: readonly CriterionDraft[],
  index: number,
  delta: -1 | 1,
): CriterionDraft[] {
  const target = index + delta;
  if (index < 0 || index >= drafts.length) return [...drafts];
  if (target < 0 || target >= drafts.length) return [...drafts];
  const next = [...drafts];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/**
 * The checks before saving, keyed like the backend's field paths. Points are
 * checked only where they count: with another ranking the field is hidden.
 */
export function validateCriteria(
  drafts: readonly CriterionDraft[],
  ranking: HolidayCriteriaRanking = "priority",
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (drafts.length > MAX_HOLIDAY_CRITERIA) {
    errors.criteria = `Es gehen höchstens ${MAX_HOLIDAY_CRITERIA} Kriterien.`;
  }
  const names = new Set<string>();
  drafts.forEach((draft, index) => {
    const name = draft.name.trim();
    if (!name) {
      errors[`criteria.${index}.name`] = "Bitte gib einen Namen ein.";
    } else if (name.length > MAX_CRITERION_NAME) {
      errors[`criteria.${index}.name`] =
        `Der Name hat höchstens ${MAX_CRITERION_NAME} Zeichen.`;
    } else if (names.has(name.toLowerCase())) {
      errors[`criteria.${index}.name`] = "Diesen Namen gibt es schon.";
    }
    names.add(name.toLowerCase());
    const question = draft.question.trim();
    if (!question) {
      errors[`criteria.${index}.question`] =
        "Bitte schreibe die Frage an die Eltern.";
    } else if (question.length > MAX_CRITERION_QUESTION) {
      errors[`criteria.${index}.question`] =
        `Die Frage hat höchstens ${MAX_CRITERION_QUESTION} Zeichen.`;
    }
    if (ranking === "points" && parsePoints(draft.points) === null) {
      errors[`criteria.${index}.points`] =
        `Bitte gib 1 bis ${MAX_CRITERION_POINTS} Punkte ein.`;
    }
  });
  return errors;
}

/**
 * The request body in the order of the list. Points that are no number can
 * only be left behind a ranking that hides them; they go out as 1.
 */
export function inputsFromDrafts(
  drafts: readonly CriterionDraft[],
): HolidayCriterionInput[] {
  return drafts.map((draft) => ({
    id: draft.id,
    name: draft.name.trim(),
    question: draft.question.trim(),
    scope: draft.scope,
    active: draft.active,
    points: parsePoints(draft.points) ?? 1,
  }));
}

/** Whether the list differs from the stored criteria. */
export function criteriaChanged(
  drafts: readonly CriterionDraft[],
  stored: readonly HolidayCriterion[],
): boolean {
  const saved = inputsFromDrafts(draftsFromCriteria(stored));
  // The typed points compare as typed, so an emptied field counts as a change.
  const current = drafts.map((draft, index) => ({
    ...inputsFromDrafts([draft])[0],
    points: parsePoints(draft.points) ?? `typed:${index}:${draft.points}`,
  }));
  return JSON.stringify(saved) !== JSON.stringify(current);
}

/**
 * The highest total a child can reach: the points of the criteria switched
 * on, or their number when every one counts the same.
 */
export function highestScore(draft: CriteriaDraft): number {
  const active = draft.items.filter((item) => item.active);
  return draft.ranking === "points"
    ? active.reduce((sum, item) => sum + (parsePoints(item.points) ?? 0), 0)
    : active.length;
}
