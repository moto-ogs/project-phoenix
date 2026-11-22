/**
 * Client of the allocation by criteria in the Träger portal (#4700): the
 * criteria of the Träger, the allocation list of a holiday period and the
 * decisions of the Träger-Büro. moto only proposes an order; every place is
 * given by a person of the office. Talks to the BFF routes under
 * /api/traeger/holiday-periods. Backend int64 IDs leave here as strings.
 */

import { knownEnum, requiredEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type * as traegerHolidayPeriodsContract from "./contract/traeger-holiday-periods.generated";
import { traegerRequest } from "./traeger-api";

const SCOPES: readonly HolidayCriterionScope[] = ["family", "child"];
const PLACEMENTS: readonly HolidayAllocationPlacement[] = [
  "placed",
  "waitlisted",
];
const CRITERION_VALUES: readonly HolidayCriterionValue[] = [
  "yes",
  "no",
  "unknown",
];
const VALUE_SOURCES = ["parent", "office"] as const;
const BOOKING_UNITS = ["week", "day"] as const;

/** Whether a criterion is asked once per family or for every child. */
export type HolidayCriterionScope = "family" | "child";

/** What the allocation decides for one booking. */
export type HolidayAllocationPlacement = "placed" | "waitlisted";

/** One criterion of the Träger, in the order of its priority. */
export interface HolidayCriterion {
  readonly id: string;
  readonly name: string;
  /** The yes/no question the parents answer. */
  readonly question: string;
  readonly scope: HolidayCriterionScope;
  readonly active: boolean;
  /** 1 is the highest priority. */
  readonly position: number;
  /** Parents answered it already: removing it archives it. */
  readonly answered: boolean;
}

/** A criterion as the editor saves it; an empty ID creates it. */
export interface HolidayCriterionInput {
  readonly id: string;
  readonly name: string;
  readonly question: string;
  readonly scope: HolidayCriterionScope;
  readonly active: boolean;
}

/** The backend's limits of the criteria. */
export const MAX_HOLIDAY_CRITERIA = 10;
export const MAX_CRITERION_NAME = 60;
export const MAX_CRITERION_QUESTION = 300;
export const MAX_ALLOCATION_REASON = 500;
export const MAX_ALLOCATION_DECISIONS = 500;

/**
 * The editor saves the whole list and archives a criterion left out, so an
 * unknown scope fails the read instead of dropping or guessing it (#2353).
 */
function criteriaFromBackend(
  data: traegerHolidayPeriodsContract.HolidayCriteriaCatalog,
): HolidayCriterion[] {
  return (data.criteria ?? []).map((criterion) => ({
    id: criterion.id,
    name: criterion.name,
    question: criterion.question,
    scope: requiredEnum(SCOPES, criterion.scope, "holiday_criterion.scope"),
    active: criterion.active,
    position: criterion.position,
    answered: criterion.answered,
  }));
}

const criteriaPath = "/api/traeger/holiday-periods/criteria";

/** The criteria of the Träger, highest priority first. */
export async function fetchHolidayCriteria(): Promise<HolidayCriterion[]> {
  return criteriaFromBackend(
    await traegerRequest<traegerHolidayPeriodsContract.HolidayCriteriaCatalog>(
      criteriaPath,
    ),
  );
}

/**
 * Saves the whole list; its order is the priority. A criterion left out is
 * archived: given answers and decisions keep it.
 */
export async function saveHolidayCriteria(
  criteria: readonly HolidayCriterionInput[],
): Promise<HolidayCriterion[]> {
  return criteriaFromBackend(
    await traegerRequest<traegerHolidayPeriodsContract.HolidayCriteriaCatalog>(
      criteriaPath,
      {
        method: "PUT",
        body: {
          criteria: criteria.map((criterion) => ({
            id: criterion.id ? criterion.id : "0",
            name: criterion.name,
            question: criterion.question,
            scope: criterion.scope,
            active: criterion.active,
          })),
        } satisfies traegerHolidayPeriodsContract.HolidayCriteriaRequest,
      },
    ),
  );
}

/** "yes" met, "no" not met, "unknown" without an answer. */
export type HolidayCriterionValue = "yes" | "no" | "unknown";

/** The value of one criterion for an open booking. */
interface HolidayAllocationCriterionValue {
  readonly criterionId: string;
  readonly value: HolidayCriterionValue;
  /** "office": the Träger-Büro checked it; "parent": the parents said so. */
  readonly source: "parent" | "office";
}

/** One open booking of a week, in the order of the proposal. */
export interface HolidayAllocationEntry {
  readonly bookingId: string;
  /** Place in the proposal of the week, from 1. */
  readonly rank: number;
  readonly registrationId: string;
  readonly submittedAt: string;
  readonly childId: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly timeModelName: string;
  /** The wanted days of a week by days; empty for a whole week. */
  readonly days: readonly string[];
  /** In the order of the priority. */
  readonly criteria: readonly HolidayAllocationCriterionValue[];
  readonly proposal: HolidayAllocationPlacement;
}

export interface HolidayAllocationWeek {
  readonly weekId: string;
  /** Calendar dates "YYYY-MM-DD". */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly hostSchoolId: string;
  readonly bookingUnit: "week" | "day";
  /** Null is unlimited. */
  readonly capacity: number | null;
  readonly placed: number;
  /** Free places; the smallest of the days for a week by days. Null is unlimited. */
  readonly free: number | null;
  readonly pending: readonly HolidayAllocationEntry[];
}

/** One decision of the office, kept for the record. */
export interface HolidayAllocationDecision {
  readonly id: string;
  readonly weekId: string;
  readonly weekStartsOn: string;
  readonly weekEndsOn: string;
  readonly registrationId: string;
  readonly childId: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly placement: HolidayAllocationPlacement;
  readonly proposal: HolidayAllocationPlacement;
  readonly rank: number;
  /** The names of the criteria met at the time of the decision. */
  readonly criteriaMet: readonly string[];
  /** Required when the decision differs from the proposal. */
  readonly reason: string;
  readonly decidedAt: string;
}

/** An active criterion as the allocation list names it. */
export interface HolidayAllocationCriterion {
  readonly id: string;
  readonly name: string;
  readonly scope: HolidayCriterionScope;
  readonly position: number;
}

export interface HolidayAllocationBoard {
  readonly criteria: readonly HolidayAllocationCriterion[];
  readonly weeks: readonly HolidayAllocationWeek[];
  /** Newest first. */
  readonly decisions: readonly HolidayAllocationDecision[];
}

/** One decision the office sends. */
export interface HolidayAllocationDecisionInput {
  readonly bookingId: string;
  readonly placement: HolidayAllocationPlacement;
  /** The proposal the office saw; the backend refuses a stale one. */
  readonly proposal: HolidayAllocationPlacement;
  readonly reason: string;
}

/**
 * The allocation list. An entry with a value this build does not know drops
 * out (#2353): it is a list, and the proposal goes back as the stale check,
 * so no entry may carry a guessed one.
 */
function boardFromBackend(
  board: traegerHolidayPeriodsContract.HolidayAllocationBoard,
): HolidayAllocationBoard {
  return {
    criteria: (board.criteria ?? []).flatMap((criterion) => {
      const scope = knownEnum(SCOPES, criterion.scope);
      return scope
        ? [
            {
              id: criterion.id,
              name: criterion.name,
              scope,
              position: criterion.position,
            },
          ]
        : [];
    }),
    weeks: (board.weeks ?? []).map((week) => ({
      weekId: week.week_id,
      startsOn: requiredDay(
        week.starts_on,
        "holiday_allocation_week.starts_on",
      ),
      endsOn: requiredDay(week.ends_on, "holiday_allocation_week.ends_on"),
      hostSchoolId: week.host_school_id,
      // Go sets the unit on every week; "week" is its default.
      bookingUnit: knownEnum(BOOKING_UNITS, week.booking_unit) ?? "week",
      capacity: week.capacity,
      placed: week.placed,
      free: week.free,
      pending: (week.pending ?? []).flatMap((entry) => {
        const proposal = knownEnum(PLACEMENTS, entry.proposal);
        if (!proposal) return [];
        return [
          {
            bookingId: entry.booking_id,
            rank: entry.rank,
            registrationId: entry.registration_id,
            submittedAt: entry.submitted_at,
            childId: entry.child_id,
            childFirstName: entry.child_first_name,
            childLastName: entry.child_last_name,
            timeModelName: entry.time_model_name,
            days: (entry.days ?? []).flatMap((day) => (day ? [day] : [])),
            criteria: (entry.criteria ?? []).flatMap((value) => {
              const known = knownEnum(CRITERION_VALUES, value.value);
              const source = knownEnum(VALUE_SOURCES, value.source);
              return known && source
                ? [{ criterionId: value.criterion_id, value: known, source }]
                : [];
            }),
            proposal,
          },
        ];
      }),
    })),
    decisions: (board.decisions ?? []).flatMap((decision) => {
      const placement = knownEnum(PLACEMENTS, decision.placement);
      const proposal = knownEnum(PLACEMENTS, decision.proposal);
      if (!placement || !proposal) return [];
      return [
        {
          id: decision.id,
          weekId: decision.week_id,
          weekStartsOn: requiredDay(
            decision.week_starts_on,
            "holiday_allocation_decision.week_starts_on",
          ),
          weekEndsOn: requiredDay(
            decision.week_ends_on,
            "holiday_allocation_decision.week_ends_on",
          ),
          registrationId: decision.registration_id,
          childId: decision.child_id,
          childFirstName: decision.child_first_name,
          childLastName: decision.child_last_name,
          placement,
          proposal,
          rank: decision.rank,
          criteriaMet: decision.criteria_met ?? [],
          reason: decision.reason,
          decidedAt: decision.decided_at,
        },
      ];
    }),
  };
}

const allocationPath = (periodId: string) =>
  `/api/traeger/holiday-periods/${encodeURIComponent(periodId)}/allocation`;

/** The open bookings of every week with the proposal, and the decisions. */
export async function fetchHolidayAllocation(
  periodId: string,
): Promise<HolidayAllocationBoard> {
  return boardFromBackend(
    await traegerRequest<traegerHolidayPeriodsContract.HolidayAllocationBoard>(
      allocationPath(periodId),
    ),
  );
}

/**
 * Decides open bookings and answers with the new list. Parents get an
 * e-mail per registration.
 */
export async function decideHolidayAllocation(
  periodId: string,
  decisions: readonly HolidayAllocationDecisionInput[],
): Promise<HolidayAllocationBoard> {
  return boardFromBackend(
    await traegerRequest<traegerHolidayPeriodsContract.HolidayAllocationBoard>(
      `${allocationPath(periodId)}/decisions`,
      {
        method: "POST",
        body: {
          decisions: decisions.map((decision) => ({
            booking_id: decision.bookingId,
            placement: decision.placement,
            proposal: decision.proposal,
            reason: decision.reason,
          })),
        } satisfies traegerHolidayPeriodsContract.HolidayAllocationRequest,
      },
    ),
  );
}
