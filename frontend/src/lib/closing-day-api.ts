// Closing day API client (#1418 3b): the tenant routes under
// /api/timetable/closing-days (SchedulesRead/Create/Update/Delete).
import { bffJson } from "./bff-fetch";
import type * as timetableContract from "./contract/timetable.generated";
import { createLogger } from "~/lib/logger";
import {
  type ClosingDay,
  mapClosingDay,
  mapClosingDays,
} from "./closing-day-helpers";

const logger = createLogger({ component: "ClosingDayApi" });

class ClosingDayService {
  async list(): Promise<ClosingDay[]> {
    return mapClosingDays(
      await bffJson("tenant", "GET /api/timetable/closing-days/"),
    );
  }

  async create(body: timetableContract.ClosingDayRequest): Promise<ClosingDay> {
    const raw = await bffJson("tenant", "POST /api/timetable/closing-days/", {
      body,
    });
    logger.info("closing_day_created", { closing_day_id: raw.id });
    return mapClosingDay(raw);
  }

  async update(
    id: string,
    body: timetableContract.ClosingDayRequest,
  ): Promise<ClosingDay> {
    const raw = await bffJson(
      "tenant",
      "PUT /api/timetable/closing-days/{id}",
      {
        params: { id },
        body,
      },
    );
    logger.info("closing_day_updated", { closing_day_id: raw.id });
    return mapClosingDay(raw);
  }

  async delete(id: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/timetable/closing-days/{id}", {
      params: { id },
    });
    logger.info("closing_day_deleted", { closing_day_id: id });
  }
}

export const closingDayService = new ClosingDayService();
