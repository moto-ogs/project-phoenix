import { describe, expect, it } from "vitest";
import {
  allocationBoard,
  allocationEntry,
  allocationWeek,
} from "~/test/fixtures/holiday-allocation";
import {
  allocationChips,
  capacityBoundary,
  criterionLabel,
  criterionRankLabel,
  decisionCriteriaText,
  deviatesFromProposal,
  freePlacesText,
  openWeeks,
  proposalDecisions,
  proposalSummary,
  proposalSummaryText,
  rankingExplanation,
  scoreText,
  waitsBehindForWish,
} from "./holiday-allocation-model";

describe("holiday allocation model (#4700)", () => {
  it("shows met and unanswered criteria in priority order, never unmet ones", () => {
    const board = allocationBoard();
    const [first, second, third] = board.weeks[0]!.pending;
    expect(
      allocationChips(first!, board.criteria).map((chip) => [
        chip.criterion.name,
        chip.value,
      ]),
    ).toEqual([["Beide Eltern berufstätig", "yes"]]);
    expect(allocationChips(second!, board.criteria)).toEqual([
      {
        criterion: board.criteria[0],
        value: "yes",
        checkedByOffice: true,
      },
      {
        criterion: board.criteria[1],
        value: "unknown",
        checkedByOffice: false,
      },
    ]);
    expect(allocationChips(third!, board.criteria)).toEqual([]);
  });

  it("reads a criterion the entry has no value for as unanswered", () => {
    const board = allocationBoard();
    const chips = allocationChips(
      allocationEntry({ criteria: [] }),
      board.criteria,
    );
    expect(chips.map((chip) => chip.value)).toEqual(["unknown", "unknown"]);
  });

  it("draws the capacity line before the first proposed waiting list entry", () => {
    expect(capacityBoundary(allocationWeek().pending)).toBe(2);
    expect(
      capacityBoundary([
        allocationEntry({ proposal: "waitlisted" }),
        allocationEntry({ proposal: "waitlisted" }),
      ]),
    ).toBeNull();
    expect(capacityBoundary([allocationEntry()])).toBeNull();
  });

  it("hides the capacity line when a later day booking still gets a place", () => {
    expect(
      capacityBoundary([
        allocationEntry({ proposal: "placed" }),
        allocationEntry({ proposal: "waitlisted" }),
        allocationEntry({ proposal: "placed" }),
      ]),
    ).toBeNull();
  });

  it("asks for a reason only when the decision differs from the proposal", () => {
    const entry = allocationEntry({ proposal: "placed" });
    expect(deviatesFromProposal(entry, "placed")).toBe(false);
    expect(deviatesFromProposal(entry, "waitlisted")).toBe(true);
  });

  it("takes over the proposal of the open weeks without a reason", () => {
    const board = allocationBoard({
      weeks: [allocationWeek(), allocationWeek({ weekId: "52", pending: [] })],
    });
    const weeks = openWeeks(board);
    expect(weeks.map((week) => week.weekId)).toEqual(["51"]);
    expect(proposalDecisions(weeks)).toEqual([
      { bookingId: "100", placement: "placed", proposal: "placed", reason: "" },
      { bookingId: "101", placement: "placed", proposal: "placed", reason: "" },
      {
        bookingId: "102",
        placement: "waitlisted",
        proposal: "waitlisted",
        reason: "",
      },
    ]);
  });

  it("counts places, waiting list and the registrations that get an e-mail", () => {
    const summary = proposalSummary([allocationWeek()]);
    expect(summary).toEqual({ places: 2, waitlisted: 1, registrations: 2 });
    expect(proposalSummaryText(summary)).toBe(
      "2 Kinder bekommen einen Platz. 1 Kind kommt auf die Warteliste.",
    );
    expect(
      proposalSummaryText({ places: 1, waitlisted: 0, registrations: 1 }),
    ).toBe("1 Kind bekommt einen Platz.");
  });

  it("names the free places of a week", () => {
    expect(freePlacesText(allocationWeek())).toBe("2 Plätze frei");
    expect(freePlacesText(allocationWeek({ free: 0 }))).toBe("Kein Platz frei");
    expect(
      freePlacesText(allocationWeek({ free: 0, bookingUnit: "day" })),
    ).toBe("Mindestens ein Tag voll");
    expect(freePlacesText(allocationWeek({ free: null }))).toBe("Ohne Grenze");
    expect(
      freePlacesText(allocationWeek({ free: 1, bookingUnit: "day" })),
    ).toBe("An jedem Tag mindestens 1 Platz frei");
  });

  it("names a criterion by its rank, never by a colour (#7411)", () => {
    expect(criterionRankLabel(1, "Geschwisterkind")).toBe("1. Geschwisterkind");
    expect(criterionRankLabel(6, "Alleinerziehend")).toBe("6. Alleinerziehend");
  });

  // #8135: the list explains its order per way of counting.
  it("names a criterion by its rank, alone, or with its points", () => {
    const [first] = allocationBoard().criteria;
    expect(criterionLabel(first!, "priority")).toBe(
      "1. Beide Eltern berufstätig",
    );
    expect(criterionLabel(first!, "equal")).toBe("Beide Eltern berufstätig");
    expect(criterionLabel(first!, "points")).toBe(
      "Beide Eltern berufstätig · 3 Punkte",
    );
    // The holiday care wish stays the step before the Träger's criteria.
    const wish = { ...first!, id: "0", name: "Ferienwunsch", points: 0 };
    expect(criterionLabel(wish, "priority")).toBe("1. Ferienwunsch");
    expect(criterionLabel(wish, "equal")).toBe("Zuerst: Ferienwunsch");
    expect(criterionLabel(wish, "points")).toBe("Zuerst: Ferienwunsch");
  });

  it("states what an entry reaches where a total decides the order", () => {
    expect(scoreText("priority", 2, 3)).toBeNull();
    expect(scoreText("equal", 2, 3)).toBe("2 von 3 Kriterien erfüllt");
    expect(scoreText("equal", 0, 1)).toBe("0 von 1 Kriterium erfüllt");
    expect(scoreText("points", 5, 6)).toBe("5 von 6 Punkten");
    expect(scoreText("points", 1, 1)).toBe("1 von 1 Punkt");
    // Without a criterion of the Träger there is no total to state.
    expect(scoreText("equal", 0, 0)).toBeNull();
    expect(scoreText("points", null, null)).toBeNull();
  });

  it("keeps the count of a decision with the criteria it met", () => {
    const decision = {
      id: "1",
      weekId: "51",
      weekStartsOn: "2027-07-05",
      weekEndsOn: "2027-07-09",
      registrationId: "7",
      childId: "9",
      childFirstName: "Mia",
      childLastName: "Muster",
      placement: "placed" as const,
      proposal: "placed" as const,
      rank: 1,
      criteriaMet: ["Beide Eltern berufstätig"],
      reason: "",
      decidedAt: "2026-09-02T08:00:00Z",
      ranking: "points" as const,
      score: 3,
      maxScore: 5,
    };
    expect(decisionCriteriaText(decision)).toBe(
      "3 von 5 Punkten: Beide Eltern berufstätig",
    );
    expect(
      decisionCriteriaText({ ...decision, ranking: "priority" as const }),
    ).toBe("Beide Eltern berufstätig");
    expect(
      decisionCriteriaText({
        ...decision,
        ranking: "equal" as const,
        score: 0,
        maxScore: 2,
        criteriaMet: [],
      }),
    ).toBe("0 von 2 Kriterien erfüllt");
    // A decision from before #8135 has no score.
    expect(
      decisionCriteriaText({
        ...decision,
        score: null,
        maxScore: null,
        criteriaMet: [],
      }),
    ).toBe("–");
  });

  // The holiday care wish (#4703) is no part of a total: a „Nein“ waits
  // behind whatever the child reaches, and the list has to say so.
  it("says that a wish „Nein“ waits behind where a total decides", () => {
    const board = allocationBoard();
    const wish = { ...board.criteria[0]!, id: "0", name: "Ferienwunsch" };
    expect(rankingExplanation("points", board.criteria)).toBe(
      "Jedes Kriterium bringt Punkte. Wer mehr Punkte hat, steht weiter oben. Bei Gleichstand zählt der Eingang. Du entscheidest.",
    );
    expect(rankingExplanation("points", [wish, ...board.criteria])).toBe(
      "Jedes Kriterium bringt Punkte. Wer mehr Punkte hat, steht weiter oben. Kinder ohne Ferienwunsch in der OGS-Anmeldung stehen dahinter. Bei Gleichstand zählt der Eingang. Du entscheidest.",
    );
    // By priority the wish is criterion 1 of the list, as before.
    expect(rankingExplanation("priority", [wish, ...board.criteria])).toBe(
      "Zuerst zählt das Kriterium mit der höchsten Priorität, dann das nächste. Bei Gleichstand zählt der Eingang. Du entscheidest.",
    );

    const no = allocationEntry({
      criteria: [{ criterionId: "0", value: "no", source: "parent" }],
    });
    expect(waitsBehindForWish(no, "equal")).toBe(true);
    expect(waitsBehindForWish(no, "priority")).toBe(false);
    expect(waitsBehindForWish(allocationEntry(), "equal")).toBe(false);
  });
});
