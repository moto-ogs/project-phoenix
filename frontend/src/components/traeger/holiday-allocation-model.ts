/**
 * What the allocation screen derives from the list of the backend (#4700):
 * where the proposal reaches the capacity, which decision differs from the
 * proposal, what „Vorschlag übernehmen“ sends and how the criteria are named.
 * The order itself comes from the backend; this module never sorts.
 */

import {
  HOLIDAY_WISH_CRITERION_ID,
  type HolidayAllocationBoard,
  type HolidayAllocationCriterion,
  type HolidayCriteriaRanking,
  type HolidayAllocationDecision,
  type HolidayAllocationDecisionInput,
  type HolidayAllocationEntry,
  type HolidayAllocationPlacement,
  type HolidayAllocationWeek,
  type HolidayCriterionValue,
} from "~/lib/traeger-holiday-allocation-api";

/**
 * A criterion with its rank in front: „1. Geschwisterkind“. Colour means
 * status only (BAUARTEN cross rule), so the rank number, not a colour,
 * ties a chip at a child to its criterion (#7411).
 */
export function criterionRankLabel(position: number, name: string): string {
  return `${position}. ${name}`;
}

/** „1 Punkt“, „3 Punkte“. */
function pointsLabel(points: number): string {
  return points === 1 ? "1 Punkt" : `${points} Punkte`;
}

/**
 * How a criterion is named where the list explains its order (#8135). By
 * priority its rank goes in front, by points its points behind; where every
 * criterion counts the same it is the name alone. The holiday care wish
 * (#4703) is no criterion of the Träger: outside the ranking by priority it
 * is named as the step that comes first.
 */
export function criterionLabel(
  criterion: HolidayAllocationCriterion,
  ranking: HolidayCriteriaRanking,
): string {
  if (ranking === "priority") {
    return criterionRankLabel(criterion.position, criterion.name);
  }
  if (criterion.id === HOLIDAY_WISH_CRITERION_ID) {
    return `Zuerst: ${criterion.name}`;
  }
  return ranking === "points"
    ? `${criterion.name} · ${pointsLabel(criterion.points)}`
    : criterion.name;
}

const RANKING_EXPLANATION: Record<HolidayCriteriaRanking, string> = {
  priority:
    "Zuerst zählt das Kriterium mit der höchsten Priorität, dann das nächste.",
  equal:
    "Jedes Kriterium zählt gleich viel. Wer mehr Kriterien erfüllt, steht weiter oben.",
  points:
    "Jedes Kriterium bringt Punkte. Wer mehr Punkte hat, steht weiter oben.",
};

/** A period that takes the holiday care wish into account (#4703) lists it. */
function hasWishRule(criteria: readonly HolidayAllocationCriterion[]): boolean {
  return criteria.some(
    (criterion) => criterion.id === HOLIDAY_WISH_CRITERION_ID,
  );
}

/**
 * The sentences that explain the order of the list. By priority the holiday
 * care wish is criterion 1 of the list. Where a total decides, the wish is
 * no part of it: a child whose wish is „Nein“ stands behind the others
 * whatever it reaches, and the explanation says so.
 */
export function rankingExplanation(
  ranking: HolidayCriteriaRanking,
  criteria: readonly HolidayAllocationCriterion[],
): string {
  const wish =
    ranking !== "priority" && hasWishRule(criteria)
      ? " Kinder ohne Ferienwunsch in der OGS-Anmeldung stehen dahinter."
      : "";
  return `${RANKING_EXPLANATION[ranking]}${wish} Bei Gleichstand zählt der Eingang. Du entscheidest.`;
}

/**
 * The entry waits behind the others for its holiday care wish „Nein“. Only
 * where a total decides: by priority the wish is criterion 1 like any other.
 */
export function waitsBehindForWish(
  entry: HolidayAllocationEntry,
  ranking: HolidayCriteriaRanking,
): boolean {
  return (
    ranking !== "priority" &&
    entry.criteria.some(
      (value) =>
        value.criterionId === HOLIDAY_WISH_CRITERION_ID && value.value === "no",
    )
  );
}

/**
 * What an entry reaches, as the line above its criteria: „2 von 3 Kriterien
 * erfüllt“ or „5 von 6 Punkten“. Null by priority, where no total decides,
 * and without a criterion of the Träger.
 */
export function scoreText(
  ranking: HolidayCriteriaRanking,
  score: number | null,
  maxScore: number | null,
): string | null {
  if (ranking === "priority" || score === null || !maxScore) return null;
  if (ranking === "points") {
    return `${score} von ${maxScore === 1 ? "1 Punkt" : `${maxScore} Punkten`}`;
  }
  return `${score} von ${maxScore === 1 ? "1 Kriterium" : `${maxScore} Kriterien`} erfüllt`;
}

/** The criteria a decision met, with what they added up to then. */
export function decisionCriteriaText(
  decision: HolidayAllocationDecision,
): string {
  const met = decision.criteriaMet.join(", ");
  const score = scoreText(decision.ranking, decision.score, decision.maxScore);
  if (!score) return met || "–";
  return met ? `${score}: ${met}` : score;
}

/** A criterion that shows at an open booking: met, or without an answer. */
export interface AllocationChip {
  readonly criterion: HolidayAllocationCriterion;
  readonly value: Exclude<HolidayCriterionValue, "no">;
  readonly checkedByOffice: boolean;
}

/**
 * The criteria an entry meets or leaves open, in the order of the priority.
 * A criterion it does not meet shows nothing: it changes no place.
 */
export function allocationChips(
  entry: HolidayAllocationEntry,
  criteria: readonly HolidayAllocationCriterion[],
): AllocationChip[] {
  const chips: AllocationChip[] = [];
  for (const criterion of criteria) {
    const value = entry.criteria.find(
      (candidate) => candidate.criterionId === criterion.id,
    );
    const shown = value?.value ?? "unknown";
    if (shown === "no") continue;
    chips.push({
      criterion,
      value: shown,
      checkedByOffice: value?.source === "office",
    });
  }
  return chips;
}

/**
 * Where the line between place and waiting list goes: the index of the
 * first entry the proposal puts on the waiting list. Null when the proposal
 * gives every entry a place, none, or places a later day booking.
 */
export function capacityBoundary(
  entries: readonly HolidayAllocationEntry[],
): number | null {
  const index = entries.findIndex((entry) => entry.proposal === "waitlisted");
  return index > 0 &&
    entries.slice(index).every((entry) => entry.proposal === "waitlisted")
    ? index
    : null;
}

/** A decision differs from the proposal and needs a reason. */
export function deviatesFromProposal(
  entry: HolidayAllocationEntry,
  placement: HolidayAllocationPlacement,
): boolean {
  return entry.proposal !== placement;
}

/** The weeks with an open booking, in the order of the list. */
export function openWeeks(
  board: HolidayAllocationBoard,
): HolidayAllocationWeek[] {
  return board.weeks.filter((week) => week.pending.length > 0);
}

/** „Vorschlag übernehmen“: every open booking as the proposal has it. */
export function proposalDecisions(
  weeks: readonly HolidayAllocationWeek[],
): HolidayAllocationDecisionInput[] {
  return weeks.flatMap((week) =>
    week.pending.map((entry) => ({
      bookingId: entry.bookingId,
      placement: entry.proposal,
      proposal: entry.proposal,
      reason: "",
    })),
  );
}

/** What taking over the proposal does, for the confirmation. */
export interface ProposalSummary {
  readonly places: number;
  readonly waitlisted: number;
  /** Registrations whose parents get an e-mail. */
  readonly registrations: number;
}

export function proposalSummary(
  weeks: readonly HolidayAllocationWeek[],
): ProposalSummary {
  const entries = weeks.flatMap((week) => week.pending);
  return {
    places: entries.filter((entry) => entry.proposal === "placed").length,
    waitlisted: entries.filter((entry) => entry.proposal === "waitlisted")
      .length,
    registrations: new Set(entries.map((entry) => entry.registrationId)).size,
  };
}

/** „4 Plätze“, „1 Kind“ and the like. */
export function countLabel(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** The sentence of the confirmation before the proposal is taken over. */
export function proposalSummaryText(summary: ProposalSummary): string {
  const parts: string[] = [];
  if (summary.places > 0) {
    parts.push(
      `${countLabel(summary.places, "Kind bekommt", "Kinder bekommen")} einen Platz`,
    );
  }
  if (summary.waitlisted > 0) {
    parts.push(
      `${countLabel(summary.waitlisted, "Kind kommt", "Kinder kommen")} auf die Warteliste`,
    );
  }
  return `${parts.join(". ")}.`;
}

/** The free places of a week in words. */
export function freePlacesText(week: HolidayAllocationWeek): string {
  if (week.free === null) return "Ohne Grenze";
  if (week.free <= 0) {
    return week.bookingUnit === "day"
      ? "Mindestens ein Tag voll"
      : "Kein Platz frei";
  }
  const places = countLabel(week.free, "Platz", "Plätze");
  return week.bookingUnit === "day"
    ? `An jedem Tag mindestens ${places} frei`
    : `${places} frei`;
}
