import { bffJson } from "~/lib/bff-fetch";
import { requiredDay } from "./contract/required-day";
import type * as traegerSchoolsContract from "./contract/traeger-schools.generated";
import { toTraegerSchool, type TraegerSchool } from "./traeger-api";

/** A closing day that closes the school today (#7672). */
export interface TraegerDayClosing {
  /** The name the school or the Träger gave the closing day. */
  readonly name: string;
  /** True for a closing day the Träger planned, false for the school's own. */
  readonly traeger: boolean;
  /** First day, only when the closing began before today. */
  readonly since: string | null;
  /** Last day, only when the closing goes on after today. */
  readonly until: string | null;
}

/** One school of the Träger with what runs differently today. */
export interface TraegerSchoolDayChanges extends TraegerSchool {
  readonly closingDays: readonly TraegerDayClosing[];
  /** Cancelled blocks of the timetable today; a number, never a name. */
  readonly cancelledBlocks: number;
}

/**
 * „Heute anders“ of the Träger (#7672): only the schools with a change
 * today, ordered by name. No person, no reason.
 */
export interface TraegerSchoolsDayChanges {
  readonly day: string;
  readonly schools: readonly TraegerSchoolDayChanges[];
  readonly asOf: string;
}

export async function fetchTraegerSchoolsDayChanges(): Promise<TraegerSchoolsDayChanges> {
  return mapTraegerSchoolsDayChanges(
    await bffJson("org", "GET /traeger/schools/day-changes"),
  );
}

function mapTraegerSchoolsDayChanges(
  changes: traegerSchoolsContract.SchoolsDayChanges,
): TraegerSchoolsDayChanges {
  return {
    day: requiredDay(changes.day, "schools_day_changes.day"),
    schools: (changes.schools ?? []).map((school) => ({
      ...toTraegerSchool(school),
      closingDays: (school.closing_days ?? []).map((closing) => ({
        name: closing.name,
        traeger: closing.traeger,
        since: closing.since,
        until: closing.until,
      })),
      cancelledBlocks: school.cancelled_blocks,
    })),
    asOf: changes.as_of,
  };
}
