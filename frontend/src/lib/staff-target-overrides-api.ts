import { bffJson } from "./bff-fetch";
import type * as staffContract from "./contract/staff.generated";

// Sonderarbeitszeit (#3259): for every Monday to Friday in [startDate,
// endDate] the staff member's daily Soll is dailyMinutes, or with
// weekdayMinutes (#3745, Monday to Friday) the Soll of that weekday. Exactly
// one of the two is set. It wins over closing days and the
// Arbeitszeitmodell; statutory holidays stay at zero.
export interface StaffTargetOverride {
  id: string;
  staffId: string;
  startDate: string;
  endDate: string;
  dailyMinutes: number | null;
  weekdayMinutes: readonly number[] | null;
  // The Ferien-Soll of a contract of the Träger (#4706); the school only
  // reads it.
  keptByTraeger?: boolean;
}

type StaffTargetOverrideInput = {
  startDate: string;
  endDate: string;
} & (
  | { dailyMinutes: number; weekdayMinutes?: never }
  | { weekdayMinutes: readonly number[]; dailyMinutes?: never }
);

function mapStaffTargetOverride(
  row: staffContract.StaffTargetOverride,
): StaffTargetOverride {
  return {
    id: row.id,
    staffId: row.staff_id,
    startDate: row.start_date.slice(0, 10),
    endDate: row.end_date.slice(0, 10),
    dailyMinutes: row.daily_minutes,
    weekdayMinutes: row.weekday_minutes,
    keptByTraeger: row.kept_by_traeger,
  };
}

const FAILED = "Failed to change target override";

function toBody(input: StaffTargetOverrideInput) {
  return {
    start_date: input.startDate,
    end_date: input.endDate,
    ...(input.weekdayMinutes
      ? { weekday_minutes: [...input.weekdayMinutes] }
      : { daily_minutes: input.dailyMinutes }),
  };
}

class StaffTargetOverrideService {
  async list(staffId: string): Promise<StaffTargetOverride[]> {
    const rows = await bffJson(
      "tenant",
      "GET /api/staff/{id}/target-overrides",
      {
        params: { id: staffId },
      },
    );
    return (rows ?? []).map(mapStaffTargetOverride);
  }

  async create(
    staffId: string,
    input: StaffTargetOverrideInput,
  ): Promise<StaffTargetOverride> {
    const row = await bffJson(
      "tenant",
      "POST /api/staff/{id}/target-overrides",
      {
        params: { id: staffId },
        body: toBody(input),
        errorMessage: FAILED,
      },
    );
    return mapStaffTargetOverride(row);
  }

  async delete(staffId: string, overrideId: string): Promise<void> {
    await bffJson(
      "tenant",
      "DELETE /api/staff/{id}/target-overrides/{overrideId}",
      { params: { id: staffId, overrideId }, errorMessage: FAILED },
    );
  }
}

export const staffTargetOverrideService = new StaffTargetOverrideService();
