// Zusatztage, die eine Schule für sich selbst anlegt (#4817, ADR 0329). Es
// sind Zeilen ihres Trägers; die Schule liest und ändert nur die Tage, die
// sie selbst angelegt hat und allein ausrichtet.

import { bffJson } from "~/lib/bff-fetch";
import {
  type HolidayPeriod,
  type HolidayPeriodInput,
  holidayPeriodFromBackend,
  holidayPeriodToBackend,
} from "~/lib/traeger-api";

/** The school's own extra days, newest first. */
export async function fetchSchoolExtraDays(): Promise<HolidayPeriod[]> {
  const days = await bffJson("tenant", "GET /api/holiday-extra-days/");
  return (days ?? []).map(holidayPeriodFromBackend);
}

export async function fetchSchoolExtraDay(id: string): Promise<HolidayPeriod> {
  return holidayPeriodFromBackend(
    await bffJson("tenant", "GET /api/holiday-extra-days/{id}", {
      params: { id },
    }),
  );
}

/** Creates an extra day of the school as a draft. */
async function createSchoolExtraDay(
  input: HolidayPeriodInput,
): Promise<HolidayPeriod> {
  return holidayPeriodFromBackend(
    await bffJson("tenant", "POST /api/holiday-extra-days/", {
      body: holidayPeriodToBackend(input),
    }),
  );
}

/** Saves the day over the version its draft rests on (ADR 0311). */
async function updateSchoolExtraDay(
  id: string,
  input: HolidayPeriodInput,
  version: string,
): Promise<HolidayPeriod> {
  return holidayPeriodFromBackend(
    await bffJson("tenant", "PUT /api/holiday-extra-days/{id}", {
      params: { id },
      body: { ...holidayPeriodToBackend(input), expected_version: version },
    }),
  );
}

/** Opens the registration of the day. */
export async function publishSchoolExtraDay(
  id: string,
): Promise<HolidayPeriod> {
  return holidayPeriodFromBackend(
    await bffJson("tenant", "POST /api/holiday-extra-days/{id}/publish", {
      params: { id },
    }),
  );
}

/** The store of the extra day form at a school. */
export const SCHOOL_EXTRA_DAY_STORE = {
  create: createSchoolExtraDay,
  update: updateSchoolExtraDay,
} as const;
