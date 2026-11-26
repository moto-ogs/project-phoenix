import { describe, expect, it } from "vitest";
import type { HolidayCriterion } from "~/lib/traeger-holiday-allocation-api";
import {
  CRITERIA_RANKINGS,
  CRITERION_TEMPLATES,
  criteriaChanged,
  draftFromRead,
  draftsFromCriteria,
  emptyCriterion,
  fromTemplate,
  highestScore,
  inputsFromDrafts,
  moveCriterion,
  parsePoints,
  pointsLabel,
  stepPoints,
  templateUsed,
  validateCriteria,
} from "./holiday-criteria-model";

const STORED: HolidayCriterion[] = [
  {
    id: "2",
    name: "Geschwisterkind ist schon angemeldet",
    question: "Ist ein Geschwisterkind schon angemeldet?",
    scope: "child",
    active: true,
    position: 2,
    points: 2,
    answered: false,
  },
  {
    id: "1",
    name: "Beide Eltern berufstätig",
    question: "Sind beide Eltern berufstätig?",
    scope: "family",
    active: true,
    position: 1,
    points: 5,
    answered: true,
  },
];

describe("holiday criteria model (#4700)", () => {
  it("orders the drafts by priority and sends them in that order", () => {
    const drafts = draftsFromCriteria(STORED);
    expect(drafts.map((draft) => draft.id)).toEqual(["1", "2"]);
    expect(inputsFromDrafts(moveCriterion(drafts, 1, -1))).toEqual([
      {
        id: "2",
        name: "Geschwisterkind ist schon angemeldet",
        question: "Ist ein Geschwisterkind schon angemeldet?",
        scope: "child",
        active: true,
        points: 2,
      },
      {
        id: "1",
        name: "Beide Eltern berufstätig",
        question: "Sind beide Eltern berufstätig?",
        scope: "family",
        active: true,
        points: 5,
      },
    ]);
  });

  it("keeps the order when a move would leave the list", () => {
    const drafts = draftsFromCriteria(STORED);
    expect(moveCriterion(drafts, 0, -1)).toEqual(drafts);
    expect(moveCriterion(drafts, 1, 1)).toEqual(drafts);
  });

  it("names the fields like the backend and refuses duplicates and too many", () => {
    const drafts = [
      { ...emptyCriterion(), name: "Härtefall", question: "?" },
      { ...emptyCriterion(), name: " härtefall ", question: "" },
      emptyCriterion(),
    ];
    expect(validateCriteria(drafts)).toEqual({
      "criteria.1.name": "Diesen Namen gibt es schon.",
      "criteria.1.question": "Bitte schreibe die Frage an die Eltern.",
      "criteria.2.name": "Bitte gib einen Namen ein.",
      "criteria.2.question": "Bitte schreibe die Frage an die Eltern.",
    });
    const many = Array.from({ length: 11 }, (_, index) => ({
      ...emptyCriterion(),
      name: `Kriterium ${index}`,
      question: "Trifft das zu?",
    }));
    expect(validateCriteria(many)).toEqual({
      criteria: "Es gehen höchstens 10 Kriterien.",
    });
  });

  it("offers templates without health or special needs and marks used ones", () => {
    const names = CRITERION_TEMPLATES.map((template) => template.name);
    expect(names).toEqual([
      "Beide Eltern berufstätig",
      "Alleinerziehend und berufstätig",
      "Geschwisterkind ist schon angemeldet",
      "Besonderer Härtefall",
    ]);
    expect(
      CRITERION_TEMPLATES.some((template) =>
        /gesundheit|förder|sonderpäd/i.test(
          `${template.name} ${template.question}`,
        ),
      ),
    ).toBe(false);
    const drafts = draftsFromCriteria(STORED);
    expect(templateUsed(drafts, "beide eltern berufstätig")).toBe(true);
    expect(templateUsed(drafts, "Besonderer Härtefall")).toBe(false);
    const fromSibling = fromTemplate(CRITERION_TEMPLATES[2]!);
    expect(fromSibling).toMatchObject({ id: "", scope: "child", active: true });
  });

  it("notices a change of order, text or switch", () => {
    const drafts = draftsFromCriteria(STORED);
    expect(criteriaChanged(drafts, STORED)).toBe(false);
    expect(criteriaChanged(moveCriterion(drafts, 0, 1), STORED)).toBe(true);
    expect(
      criteriaChanged(
        drafts.map((draft, index) =>
          index === 0 ? { ...draft, active: false } : draft,
        ),
        STORED,
      ),
    ).toBe(true);
  });

  // #8135: the criteria count by their order, all the same, or by points.
  it("offers the three ways of counting, the order as priority first", () => {
    expect(CRITERIA_RANKINGS.map((ranking) => ranking.value)).toEqual([
      "priority",
      "equal",
      "points",
    ]);
  });

  it("takes whole points from 1 to 100 and nothing else", () => {
    expect(parsePoints(" 7 ")).toBe(7);
    expect(parsePoints("100")).toBe(100);
    for (const text of ["", "0", "101", "1,5", "-2", "drei"]) {
      expect(parsePoints(text)).toBeNull();
    }
    expect(stepPoints("1", -1)).toBe("1");
    expect(stepPoints("100", 1)).toBe("100");
    expect(stepPoints("4", 1)).toBe("5");
    expect(stepPoints("", 1)).toBe("1");
    expect(pointsLabel(1)).toBe("1 Punkt");
    expect(pointsLabel(4)).toBe("4 Punkte");
  });

  it("checks the points only where they count", () => {
    const drafts = draftsFromCriteria(STORED).map((draft, index) =>
      index === 1 ? { ...draft, points: "" } : draft,
    );
    expect(validateCriteria(drafts, "priority")).toEqual({});
    expect(validateCriteria(drafts, "equal")).toEqual({});
    expect(validateCriteria(drafts, "points")).toEqual({
      "criteria.1.points": "Bitte gib 1 bis 100 Punkte ein.",
    });
    // Hidden points that are no number go out as 1, never as an error.
    expect(inputsFromDrafts(drafts)[1]?.points).toBe(1);
  });

  it("notices changed points and adds up what a child can reach", () => {
    const drafts = draftsFromCriteria(STORED);
    const edited = drafts.map((draft, index) =>
      index === 0 ? { ...draft, points: "9" } : draft,
    );
    expect(criteriaChanged(edited, STORED)).toBe(true);
    expect(
      criteriaChanged(
        drafts.map((draft, index) =>
          index === 0 ? { ...draft, points: "" } : draft,
        ),
        STORED,
      ),
    ).toBe(true);

    const read = { criteria: STORED, ranking: "points" as const, version: "v" };
    expect(highestScore(draftFromRead(read))).toBe(7);
    expect(highestScore({ ...draftFromRead(read), ranking: "equal" })).toBe(2);
    // A criterion switched off adds nothing.
    expect(
      highestScore({
        ranking: "points",
        items: edited.map((draft, index) =>
          index === 1 ? { ...draft, active: false } : draft,
        ),
      }),
    ).toBe(9);
  });
});
