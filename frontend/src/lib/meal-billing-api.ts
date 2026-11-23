// lib/meal-billing-api.ts
// Client of the Mensa-Monatsfreigabe (#4686): the OGS-Leitung checks who
// ate in a month and releases it for the Träger's billing. Calendar dates
// stay "YYYY-MM-DD"; backend int64 IDs leave as strings.

import { knownEnum } from "~/lib/contract/known-enum";
import type * as wire from "~/lib/contract/meal-billing-months.generated";
import { bffJson } from "./bff-fetch";

export type MealBillingStatus = "running" | "open" | "released" | "expired";

export interface MealBillingSummary {
  readonly month: string;
  readonly status: MealBillingStatus;
  readonly releasedAt: string | null;
  readonly childCount: number | null;
  readonly mealCount: number | null;
}

export interface MealBillingChild {
  readonly studentId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly schoolClass: string;
  readonly registeredDays: number;
  readonly mealDays: number;
  /** Registered school days without attendance; empty once released. */
  readonly absentDates: readonly string[];
}

export interface MealBillingMonth {
  readonly month: string;
  readonly status: MealBillingStatus;
  readonly schoolDays: number;
  readonly releasedAt: string | null;
  readonly childCount: number;
  readonly mealCount: number;
  readonly absenceCount: number;
  readonly children: readonly MealBillingChild[];
  /** The computed state the release sends back; empty once released. */
  readonly fingerprint: string;
  /** The release shown, 0 before the first. */
  readonly version: number;
  /** Every release of the month, newest first. */
  readonly releases: readonly MealBillingRelease[];
  /** The month as counted now when it differs from its release (#4686). */
  readonly current: MealBillingMonth | null;
}

/** One release of a month: when, why (empty for the first) and its counts. */
interface MealBillingRelease {
  readonly version: number;
  readonly releasedAt: string;
  readonly reason: string;
  readonly childCount: number;
  readonly mealCount: number;
}

const STATUSES: readonly MealBillingStatus[] = [
  "running",
  "open",
  "released",
  "expired",
];

/** A status this build does not know offers no release: it reads as expired. */
const status = (value: string): MealBillingStatus =>
  knownEnum(STATUSES, value) ?? "expired";

function monthFromBackend(
  body: wire.BillingMonthState & { current?: wire.BillingMonthState },
): MealBillingMonth {
  return {
    month: body.month,
    status: status(body.status),
    schoolDays: body.school_days,
    releasedAt: body.released_at,
    childCount: body.child_count,
    mealCount: body.meal_count,
    absenceCount: body.absence_count,
    fingerprint: body.fingerprint,
    version: body.version,
    releases: (body.releases ?? []).map((release) => ({
      version: release.version,
      releasedAt: release.released_at,
      reason: release.reason,
      childCount: release.child_count,
      mealCount: release.meal_count,
    })),
    current: body.current ? monthFromBackend(body.current) : null,
    children: (body.children ?? []).map((child) => ({
      studentId: child.student_id,
      firstName: child.first_name,
      lastName: child.last_name,
      schoolClass: child.school_class,
      registeredDays: child.registered_days,
      mealDays: child.meal_days,
      absentDates: child.absent_dates ?? [],
    })),
  };
}

/** The current month and the eleven before it, the latest first. */
export async function fetchMealBillingMonths(): Promise<MealBillingSummary[]> {
  const body = await bffJson("tenant", "GET /api/meal-billing-months/", {
    errorMessage: "meal billing request failed",
  });
  return body.map((summary) => ({
    month: summary.month,
    status: status(summary.status),
    releasedAt: summary.released_at,
    childCount: summary.child_count,
    mealCount: summary.meal_count,
  }));
}

export async function fetchMealBillingMonth(
  month: string,
): Promise<MealBillingMonth> {
  return monthFromBackend(
    await bffJson("tenant", "GET /api/meal-billing-months/{month}", {
      params: { month },
      errorMessage: "meal billing request failed",
    }),
  );
}

/**
 * Releases the month the OGS-Leitung checked: its children and meals. A
 * released month is released again with a reason after a correction.
 */
export async function releaseMealBillingMonth(
  month: Pick<
    MealBillingMonth,
    "month" | "childCount" | "mealCount" | "fingerprint"
  >,
  reason = "",
): Promise<MealBillingMonth> {
  return monthFromBackend(
    await bffJson("tenant", "POST /api/meal-billing-months/{month}/release", {
      params: { month: month.month },
      body: {
        child_count: month.childCount,
        meal_count: month.mealCount,
        fingerprint: month.fingerprint,
        reason,
      },
      errorMessage: "meal billing request failed",
    }),
  );
}
