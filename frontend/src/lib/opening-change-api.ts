// Changed opening hours of a school on single days (#7654): the tenant
// routes under /api/opening-changes (SchedulesRead/Create/Update/Delete),
// maintained beside the closing days.
import { bffJson } from "./bff-fetch";
import type * as contract from "./contract/opening-changes.generated";
import { formatDate } from "./date-helpers";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "OpeningChangeApi" });

/** One range of days with other opening hours; times are "HH:MM". */
export interface OpeningChange {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly reason: string;
  readonly version: string;
}

/** What the form sends for a new day. */
export interface OpeningChangeInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly reason: string;
}

export function mapOpeningChange(
  raw: contract.OpeningChangeResponse,
): OpeningChange {
  return {
    id: raw.id,
    startDate: raw.start_date ?? "",
    endDate: raw.end_date ?? "",
    opensAt: raw.opens_at,
    closesAt: raw.closes_at,
    reason: raw.reason,
    version: raw.version,
  };
}

/** „17.01.2031“ or „16.01.2031 – 17.01.2031“. */
export function formatOpeningChangeDays(
  change: Pick<OpeningChange, "startDate" | "endDate">,
): string {
  if (change.startDate === change.endDate) return formatDate(change.startDate);
  return `${formatDate(change.startDate)} – ${formatDate(change.endDate)}`;
}

/** „07:30 bis 12:00 Uhr“. */
export function formatOpeningChangeHours(
  change: Pick<OpeningChange, "opensAt" | "closesAt">,
): string {
  return `${change.opensAt} bis ${change.closesAt} Uhr`;
}

function requestBody(input: OpeningChangeInput): contract.OpeningChangeRequest {
  return {
    start_date: input.startDate,
    end_date: input.endDate,
    opens_at: input.opensAt,
    closes_at: input.closesAt,
    reason: input.reason,
  };
}

class OpeningChangeService {
  async list(from: string, to: string): Promise<OpeningChange[]> {
    const rows = await bffJson("tenant", "GET /api/opening-changes/", {
      query: { from, to },
    });
    return rows.map(mapOpeningChange);
  }

  async create(input: OpeningChangeInput): Promise<OpeningChange> {
    const raw = await bffJson("tenant", "POST /api/opening-changes/", {
      body: requestBody(input),
    });
    logger.info("opening_change_created", { opening_change_id: raw.id });
    return mapOpeningChange(raw);
  }

  async delete(id: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/opening-changes/{id}", {
      params: { id },
    });
    logger.info("opening_change_deleted", { opening_change_id: id });
  }
}

export const openingChangeService = new OpeningChangeService();
