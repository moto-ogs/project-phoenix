// Calendar period API client: the tenant routes under /api/timetable/periods
// (CRUD via SchedulesRead/Create/Update/Delete).
import { bffJson } from "./bff-fetch";
import type * as timetableContract from "./contract/timetable.generated";
import { createLogger } from "~/lib/logger";
import {
  type CalendarPeriod,
  type CalendarPeriodSaveResult,
  mapPeriod,
  mapPeriods,
  mapPeriodWithWarnings,
} from "./calendar-period-helpers";

const logger = createLogger({ component: "CalendarPeriodApi" });

class CalendarPeriodService {
  async list(): Promise<CalendarPeriod[]> {
    return mapPeriods(await bffJson("tenant", "GET /api/timetable/periods/"));
  }

  async get(id: string): Promise<CalendarPeriod> {
    return mapPeriod(
      await bffJson("tenant", "GET /api/timetable/periods/{id}", {
        params: { id },
      }),
    );
  }

  /**
   * POST /api/timetable/periods/bootstrap — idempotent default-period
   * setup. Returns the tenant's periods (creating a default school-year
   * period first when none exists) plus whether a period was created by
   * this call.
   */
  async bootstrap(): Promise<{ periods: CalendarPeriod[]; created: boolean }> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/periods/bootstrap",
    );
    logger.info("periods_bootstrapped", {
      period_count: (raw.periods ?? []).length,
      created: raw.created,
    });
    return {
      periods: mapPeriods(raw.periods ?? []),
      created: raw.created,
    };
  }

  async create(
    body: timetableContract.CalendarPeriodRequest,
  ): Promise<CalendarPeriodSaveResult> {
    const raw = await bffJson("tenant", "POST /api/timetable/periods/", {
      body,
    });
    logger.info("period_created", {
      period_id: raw.id,
      period_type: raw.period_type,
      warning_count: (raw.warnings ?? []).length,
    });
    return mapPeriodWithWarnings(raw);
  }

  async update(
    id: string,
    body: timetableContract.CalendarPeriodRequest,
  ): Promise<CalendarPeriodSaveResult> {
    const raw = await bffJson("tenant", "PUT /api/timetable/periods/{id}", {
      params: { id },
      body,
    });
    logger.info("period_updated", {
      period_id: raw.id,
      warning_count: (raw.warnings ?? []).length,
    });
    return mapPeriodWithWarnings(raw);
  }

  async delete(id: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/timetable/periods/{id}", {
      params: { id },
    });
    logger.info("period_deleted", { period_id: id });
  }
}

export const calendarPeriodService = new CalendarPeriodService();
