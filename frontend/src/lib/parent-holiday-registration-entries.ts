// Die eigenen Ferienanmeldungen eines Elternkontos (#6673, ADR 0216): die
// Anmeldungen, die mit dem Konto verknüpft sind, neueste zuerst. Ohne
// Gesundheitsangaben, Anschrift und Kontakte.

import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type * as parentMeContract from "./contract/parent-me.generated";

// Go does not register this set; the contract types it as string. A value
// this build does not know stays undefined instead of passing as a known one.
const HOLIDAY_PLACEMENT_VALUES = ["placed", "waitlisted", "pending"] as const;

/** Platz, Warteliste oder offener Platz einer Woche (#4699, #4700). */
export type HolidayPlacement = (typeof HOLIDAY_PLACEMENT_VALUES)[number];

/**
 * The placement a value names, or undefined for one this build does not
 * know: the page shows „–“ instead of promising a place.
 */
export function knownHolidayPlacement(
  value: string | undefined,
): HolidayPlacement | undefined {
  return knownEnum(HOLIDAY_PLACEMENT_VALUES, value);
}

export type HolidayRegistrationEntryStatus =
  "received" | "confirmed" | "cancelled";

/** One week of one child: its time model and whether it got a place. */
interface HolidayRegistrationEntryWeek {
  /** "YYYY-MM-DD" */
  readonly firstDay: string;
  /** "YYYY-MM-DD" */
  readonly lastDay: string;
  readonly timeModelName: string;
  /** undefined: a placement this build does not know. */
  readonly placement: HolidayPlacement | undefined;
  /** The child eats lunch in the week (#5631). */
  readonly lunch?: boolean;
}

interface HolidayRegistrationEntryChild {
  readonly firstName: string;
  readonly weeks: readonly HolidayRegistrationEntryWeek[];
}

export interface HolidayRegistrationEntry {
  readonly id: string;
  readonly traegerName: string;
  readonly periodName: string;
  /** "YYYY-MM-DD", or "" while the period has no weeks. */
  readonly firstDay: string;
  readonly lastDay: string;
  /** RFC 3339 instant. */
  readonly submittedAt: string;
  readonly status: HolidayRegistrationEntryStatus;
  readonly children: readonly HolidayRegistrationEntryChild[];
}

/**
 * Every registration starts "received" in Go; a state this build does not
 * know reads as that start, which only labels the entry.
 */
export function entryStatus(value: string): HolidayRegistrationEntryStatus {
  return value === "confirmed" || value === "cancelled" ? value : "received";
}

function holidayRegistrationEntryFromBackend(
  entry: parentMeContract.HolidayRegistrationEntryResponse,
): HolidayRegistrationEntry {
  return {
    id: entry.id,
    traegerName: entry.traeger_name,
    periodName: entry.period_name,
    firstDay: entry.first_day ?? "",
    lastDay: entry.last_day ?? "",
    submittedAt: entry.submitted_at,
    status: entryStatus(entry.status),
    children: (entry.children ?? []).map((child) => ({
      firstName: child.first_name,
      weeks: (child.weeks ?? []).map((week) => ({
        firstDay: requiredDay(
          week.first_day,
          "HolidayRegistrationEntryWeek.first_day",
        ),
        lastDay: requiredDay(
          week.last_day,
          "HolidayRegistrationEntryWeek.last_day",
        ),
        timeModelName: week.time_model_name,
        placement: knownHolidayPlacement(week.placement),
        ...(week.lunch ? { lunch: true } : {}),
      })),
    })),
  };
}

/** The entries of the answer in the backend's order, newest first. */
export function holidayRegistrationEntriesFromBackend(
  body: parentMeContract.HolidayRegistrationEntriesResponse,
): HolidayRegistrationEntry[] {
  return (body.registrations ?? []).map(holidayRegistrationEntryFromBackend);
}
