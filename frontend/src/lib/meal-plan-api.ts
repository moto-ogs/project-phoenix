// lib/meal-plan-api.ts
// API client for the meal plan (Essensplan). Staff read a week and replace a
// day; the feature is gated per tenant by the backend.

import type * as wire from "~/lib/contract/meal-plan.generated";
import { ApiError } from "./api-error";
import { bffFile, bffJson } from "./bff-fetch";
import { knownEnum } from "./contract/known-enum";
import { downloadBlob, filenameFromDisposition } from "./file-download";
import { parseISODate, toISODate } from "./date-helpers";
import { createLogger } from "~/lib/logger";
import {
  normalizeMealAllergens,
  type MealAllergen,
} from "~/lib/meal-allergens";

const logger = createLogger({ component: "MealPlanAPI" });

export function isMealWeekendDay(date: Date): boolean {
  return date.getDay() === 0 || date.getDay() === 6;
}

/** The daily kitchen list opens on today or the first weekday after it. */
export function mealParticipantDate(today: string): string {
  const candidate = parseISODate(today);
  while (isMealWeekendDay(candidate)) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return toISODate(candidate);
}

/** One dish on a day of the meal plan as used by the UI. */
export interface MealPlanDish {
  dish: string;
  note: string | null;
  /** Codes of the main allergens, in legend order; empty when unmarked. */
  allergens: MealAllergen[];
}

/**
 * One weekday of the meal plan as stored. `version` is the server's token of
 * the day's dishes (ADR 0311); a save of the day sends it back. An empty day
 * has one too.
 */
export interface MealPlanDay {
  date: string; // YYYY-MM-DD
  version: string;
  dishes: MealPlanDish[];
}

/** One dish in a day submission. */
export interface DishInput {
  dish: string;
  note: string | null;
  /** Omitted means no marking. */
  allergens?: MealAllergen[];
}

export interface DailyMealParticipant {
  studentId: string;
  firstName: string;
  lastName: string;
  schoolClass: string;
}

export interface DailyMealList {
  date: string;
  cutoffTime: string;
  // RFC 3339 instant when the day's order is fixed (#3873).
  deadline: string;
  // A closing day or public holiday: nobody eats.
  closed: boolean;
  // Closed because the school cancelled lunch while it is open (#7656).
  mealCancelled?: boolean;
  participants: DailyMealParticipant[];
  // Enrolled children who do not eat that day; only when asked for.
  others: DailyMealParticipant[];
}

export interface WeeklyMealList {
  weekStart: string;
  // closed: a closing day or public holiday, nobody eats.
  days: Array<{
    date: string;
    closed: boolean;
    mealCancelled?: boolean;
    participants: DailyMealParticipant[];
  }>;
}

export function mapMealPlanDay(day: wire.MealPlanDayResponse): MealPlanDay {
  return {
    date: day.date,
    version: day.version,
    dishes: (day.dishes ?? []).map((dish) => ({
      dish: dish.dish,
      note: dish.note?.trim() ? dish.note : null,
      allergens: normalizeMealAllergens(dish.allergens),
    })),
  };
}

/** Fetch Monday to Friday of the week containing weekStart (ISO). */
export async function getMealPlanWeek(
  weekStart: string,
): Promise<MealPlanDay[]> {
  const days = await bffJson("tenant", "GET /api/meal-plan/days", {
    query: { week_start: weekStart },
    errorMessage: "meal plan load failed",
  });
  return days.map(mapMealPlanDay);
}

/**
 * Replace all dishes for one day (empty list clears the day) and answer the
 * day as stored, with its new version. `expectedVersion` is the version of
 * the day as this page read it: when someone stored it differently since,
 * the backend refuses the save with `general.changed_since_read` instead of
 * overwriting their change.
 */
export async function setDay(
  date: string,
  dishes: DishInput[],
  expectedVersion: string,
): Promise<MealPlanDay> {
  try {
    const day = await bffJson("tenant", "PUT /api/meal-plan/days/{date}", {
      params: { date },
      body: { dishes, expected_version: expectedVersion },
      errorMessage: "meal plan day save failed",
    });
    return mapMealPlanDay(day);
  } catch (error) {
    logger.error("meal_set_day_failed", {
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
}

function dailyParticipant(participant: wire.DailyParticipantResponse) {
  return {
    studentId: participant.student_id,
    firstName: participant.first_name,
    lastName: participant.last_name,
    schoolClass: participant.school_class,
  };
}

/**
 * The day list; with `includeOthers` it also names the enrolled children who
 * do not eat that day, for the school's late changes (#3873).
 */
export async function getDailyMealParticipants(
  date: string,
  includeOthers = false,
): Promise<DailyMealList> {
  const data = await bffJson("tenant", "GET /api/meal-plan/participants", {
    query: { date, include: includeOthers ? "all" : undefined },
    errorMessage: "meal participants load failed",
  });
  return mapDailyMealList(data);
}

export function mapDailyMealList(data: wire.DailyListResponse): DailyMealList {
  return {
    date: data.date,
    cutoffTime: data.cutoff_time,
    deadline: data.deadline,
    closed: data.closed,
    mealCancelled: data.meal_cancelled,
    participants: (data.participants ?? []).map(dailyParticipant),
    others: (data.others ?? []).map(dailyParticipant),
  };
}

/**
 * A child's regular meal days as the school sees them (#3873). `version` is
 * the server's token of the stored regular days (ADR 0311); a change of them
 * sends it back.
 */
export interface ChildMealSchedule {
  weekdays: number[];
  effectiveFrom: string | null;
  version: string;
}

export async function getChildMealSchedule(
  studentId: string,
  date: string,
): Promise<ChildMealSchedule> {
  const schedule = await bffJson(
    "tenant",
    "GET /api/meal-plan/participation/{studentId}",
    {
      params: { studentId },
      query: { from: date, to: date },
      errorMessage: "meal schedule load failed",
    },
  );
  return {
    weekdays: schedule.weekdays ?? [],
    effectiveFrom: schedule.effective_from ?? null,
    version: schedule.version,
  };
}

/** The school registers (true) or cancels (false) a child's day. */
export async function setChildMealDay(
  studentId: string,
  date: string,
  participating: boolean,
): Promise<void> {
  await bffJson(
    "tenant",
    "PUT /api/meal-plan/participation/{studentId}/days/{date}",
    {
      params: { studentId, date },
      body: { participating },
      errorMessage: "meal day change failed",
    },
  );
}

/** The school returns a child's day to the regular days. */
export async function clearChildMealDay(
  studentId: string,
  date: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "DELETE /api/meal-plan/participation/{studentId}/days/{date}",
    { params: { studentId, date }, errorMessage: "meal day reset failed" },
  );
}

/**
 * The school sets a child's regular days from a day on, against the
 * `version` of the regular days it read.
 */
export async function replaceChildMealSchedule(
  studentId: string,
  weekdays: number[],
  effectiveFrom: string,
  expectedVersion: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "PUT /api/meal-plan/participation/{studentId}/schedule",
    {
      params: { studentId },
      body: {
        weekdays,
        effective_from: effectiveFrom,
        expected_version: expectedVersion,
      },
      errorMessage: "meal schedule change failed",
    },
  );
}

/** Kitchen list of every school day in the week containing weekStart. */
export async function getWeeklyMealParticipants(
  weekStart: string,
): Promise<WeeklyMealList> {
  const data = await bffJson("tenant", "GET /api/meal-plan/participants/week", {
    query: { week_start: weekStart },
    errorMessage: "weekly meal participants load failed",
  });
  return {
    weekStart: data.week_start,
    days: (data.days ?? []).map((day) => ({
      date: day.date,
      closed: day.closed,
      mealCancelled: day.meal_cancelled,
      participants: (day.participants ?? []).map(dailyParticipant),
    })),
  };
}

export async function downloadDailyMealParticipants(
  date: string,
  format: "pdf" | "xlsx",
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "GET /api/meal-plan/participants/export",
    {
      query: { date, format },
      errorMessage: "meal participants export failed",
    },
  );
  downloadBlob(await response.blob(), `mittagessen-${date}.${format}`);
}

export async function downloadWeeklyMealParticipants(
  weekStart: string,
  format: "pdf" | "xlsx",
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "GET /api/meal-plan/participants/week/export",
    {
      query: { week_start: weekStart, format },
      errorMessage: "meal participants export failed",
    },
  );
  downloadBlob(
    await response.blob(),
    `mittagessen-woche-${weekStart}.${format}`,
  );
}

/** Monday (ISO) of the week containing the given Date. */
export function mondayOf(date: Date): string {
  const offset = (date.getDay() + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(date);
  monday.setDate(date.getDate() - offset);
  return toISODate(monday);
}

/** The five working-day ISO dates (Mon-Fri) starting at mondayISO. */
export function workWeekDates(mondayISO: string): string[] {
  const monday = parseISODate(mondayISO);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toISODate(d);
  });
}

/** Where a day's order stands (#3873). */
const ORDER_STATUSES = ["open", "ordered", "confirmed", "unordered"] as const;
type MealOrderStatus = (typeof ORDER_STATUSES)[number];
const RHYTHMS = ["daily", "weekly"] as const;
const DETAILS = ["total", "by_class"] as const;

export interface MealOrderDay {
  date: string;
  closed: boolean;
  // Closed because the school cancelled lunch while it is open (#7656).
  mealCancelled?: boolean;
  // RFC 3339 instant: the deadline of the day or of its order.
  deadline: string;
  status: MealOrderStatus;
  confirmedAt: string | null;
  total: number;
  classes: { schoolClass: string; count: number }[];
  changes: { sequence: number; schoolClass: string; delta: number }[];
}

export interface MealOrders {
  rhythm: "daily" | "weekly";
  detail: "total" | "by_class";
  days: MealOrderDay[];
}

/** The school's display of orders for [from, to]; only the worker and writes settle orders. */
export async function getMealOrders(
  from: string,
  to: string,
): Promise<MealOrders> {
  const data = await bffJson("tenant", "GET /api/meal-plan/orders", {
    query: { from, to },
    errorMessage: "meal orders load failed",
  });
  return mapMealOrders(data);
}

export function mapMealOrders(data: wire.OrdersResponse): MealOrders {
  return {
    rhythm: knownEnum(RHYTHMS, data.rhythm) ?? "daily",
    detail: knownEnum(DETAILS, data.detail) ?? "total",
    days: (data.days ?? []).map((day) => ({
      date: day.date,
      closed: day.closed,
      mealCancelled: day.meal_cancelled,
      deadline: day.deadline,
      status: knownEnum(ORDER_STATUSES, day.status) ?? "open",
      confirmedAt: day.confirmed_at ?? null,
      total: day.total,
      classes: (day.classes ?? []).map((count) => ({
        schoolClass: count.school_class,
        count: count.count,
      })),
      changes: (day.changes ?? []).map((change) => ({
        sequence: change.sequence,
        schoolClass: change.school_class,
        delta: change.delta,
      })),
    })),
  };
}

/** Downloads the ordered meals per child of a month ("YYYY-MM"). */
export async function downloadMealMonth(
  month: string,
  format: "pdf" | "xlsx",
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "GET /api/meal-plan/orders/month/export",
    { query: { month, format }, errorMessage: "meal month export failed" },
  );
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mittagessen-${month}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Downloads the school's delivery list of [from, to] (#3873): the same
 * document its caterer gets, without names.
 */
export async function downloadMealDeliveries(
  from: string,
  to: string,
  format: "pdf" | "xlsx" | "csv",
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "GET /api/meal-caterer/orders/export",
    {
      query: { from, to, format },
      errorMessage: "meal delivery export failed",
    },
  );
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ??
      `lieferliste-${from}-bis-${to}.${format}`,
  );
}

/** A day without lunch although the school is open (#7656). */
export interface MealCancellation {
  date: string;
  reason: string;
}

/** The days without lunch of [from, to]. */
export async function getMealCancellations(
  from: string,
  to: string,
): Promise<MealCancellation[]> {
  const rows = await bffJson("tenant", "GET /api/meal-plan/cancellations", {
    query: { from, to },
    errorMessage: "meal cancellations load failed",
  });
  return rows.map((row) => ({ date: row.date, reason: row.reason }));
}

/** Cancels lunch on a day, or replaces the reason of a cancelled day. */
export async function cancelMeal(date: string, reason: string): Promise<void> {
  await bffJson("tenant", "PUT /api/meal-plan/days/{date}/cancellation", {
    params: { date },
    body: { reason },
    errorMessage: "meal cancellation failed",
  });
}

/** Lets lunch take place again on a day: the bookings apply again. */
export async function restoreMeal(date: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/meal-plan/days/{date}/cancellation", {
    params: { date },
    errorMessage: "meal restore failed",
  });
}
