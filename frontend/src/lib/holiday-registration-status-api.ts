// Stand einer Ferienanmeldung über den geheimen Link aus der Eingangsmail
// (#6676): ohne Elternkonto, ohne Gesundheitsangaben, Anschrift, Kontakte,
// Nachnamen und Geburtsdaten.

import { unavailableApiError } from "~/lib/api-error";
import { requiredDay } from "~/lib/contract/required-day";
import type { HolidayRegistrationStatusResponse as WireHolidayRegistrationStatus } from "~/lib/contract/traeger-holiday-registrations.generated";
import { readEnrollmentError } from "~/lib/enrollment-api-error";
import { createLogger } from "~/lib/logger";
import {
  entryStatus,
  knownHolidayPlacement,
  type HolidayPlacement,
  type HolidayRegistrationEntryStatus,
} from "~/lib/parent-holiday-registration-entries";

const logger = createLogger({ component: "HolidayRegistrationStatusApi" });

/** The address of the status page on the parents host, by its token. */
export function holidayRegistrationStatusPath(token: string): string {
  return `/parents/ferienanmeldung/status/${encodeURIComponent(token)}`;
}

export interface HolidayRegistrationStatusWeek {
  /** "YYYY-MM-DD" */
  readonly firstDay: string;
  /** "YYYY-MM-DD" */
  readonly lastDay: string;
  readonly timeModelName: string;
  /** "HH:MM", or "" when unknown. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly hostSchoolName: string;
  /** undefined: a placement this build does not know. */
  readonly placement: HolidayPlacement | undefined;
  /** The child eats lunch in the week (#5631). */
  readonly lunch?: boolean;
}

export interface HolidayRegistrationStatusChild {
  readonly firstName: string;
  readonly weeks: readonly HolidayRegistrationStatusWeek[];
}

export interface HolidayRegistrationStatus {
  readonly traegerName: string;
  readonly periodName: string;
  /** "YYYY-MM-DD", or "" while the period has no weeks. */
  readonly firstDay: string;
  readonly lastDay: string;
  /** "YYYY-MM-DD": the last day parents can register. */
  readonly registrationClosesOn: string;
  readonly binding: boolean;
  /** "criteria": the office gives the places after the window closes. */
  readonly allocationMode: "arrival" | "criteria";
  /** RFC 3339 instant. */
  readonly submittedAt: string;
  readonly status: HolidayRegistrationEntryStatus;
  readonly children: readonly HolidayRegistrationStatusChild[];
}

function holidayRegistrationStatusFromBackend(
  body: WireHolidayRegistrationStatus,
): HolidayRegistrationStatus {
  return {
    traegerName: body.traeger_name,
    periodName: body.period_name,
    firstDay: body.first_day ?? "",
    lastDay: body.last_day ?? "",
    registrationClosesOn: requiredDay(
      body.registration_closes_on,
      "HolidayRegistrationStatus.registration_closes_on",
    ),
    binding: body.binding,
    allocationMode:
      body.allocation_mode === "criteria" ? "criteria" : "arrival",
    submittedAt: body.submitted_at,
    status: entryStatus(body.status),
    children: (body.children ?? []).map((child) => ({
      firstName: child.first_name,
      weeks: (child.weeks ?? []).map((week) => ({
        firstDay: requiredDay(
          week.first_day,
          "HolidayRegistrationStatusWeek.first_day",
        ),
        lastDay: requiredDay(
          week.last_day,
          "HolidayRegistrationStatusWeek.last_day",
        ),
        timeModelName: week.time_model_name,
        startsAt: week.starts_at,
        endsAt: week.ends_at,
        hostSchoolName: week.host_school_name,
        placement: knownHolidayPlacement(week.placement),
        ...(week.lunch ? { lunch: true } : {}),
      })),
    })),
  };
}

/** Reads the state of the registration a status link names. */
export async function fetchHolidayRegistrationStatus(
  token: string,
): Promise<HolidayRegistrationStatus> {
  let response: Response;
  try {
    response = await fetch(
      `/api/traeger/holiday-registrations/status/${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
  } catch (cause) {
    throw unavailableApiError(cause);
  }
  if (!response.ok) {
    throw await readEnrollmentError(
      response,
      "Stand der Ferienanmeldung konnte nicht geladen werden",
      logger,
      "holiday_registration_status_api_failed",
    );
  }
  const body = (await response.json()) as {
    data: WireHolidayRegistrationStatus;
  };
  return holidayRegistrationStatusFromBackend(body.data);
}
