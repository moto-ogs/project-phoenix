import type { NextRequest } from "next/server";
import { apiPut } from "~/lib/api-helpers.server";
import { createPutHandler, isStringParam } from "~/lib/route-wrapper.server";

/**
 * Temporary (#2352): the client sends the backend's field names since this
 * release, and the catalog proxy will answer this route once this file is
 * gone. It stays one release for an installed app with an older bundle, which
 * still sends the camelCase body.
 */
interface UpdateSessionRequest {
  date?: string;
  status?: "present" | "home_office";
  notes?: string;
  checkInTime?: string;
  checkOutTime?: string;
  breakMinutes?: number;
  check_in_time?: string;
  check_out_time?: string;
  break_minutes?: number;
  breaks?: Array<{
    id: string;
    durationMinutes?: number;
    duration_minutes?: number;
  }>;
}

/**
 * PUT /api/time-tracking/{id}
 * Update a work session
 */
export const PUT = createPutHandler<unknown, UpdateSessionRequest>(
  async (
    _request: NextRequest,
    body: UpdateSessionRequest,
    token: string,
    params,
  ) => {
    if (!isStringParam(params.id)) {
      throw new Error("Invalid session ID");
    }

    const backendBody: Record<string, unknown> = {
      date: body.date,
      check_in_time: body.check_in_time ?? body.checkInTime,
      check_out_time: body.check_out_time ?? body.checkOutTime,
      break_minutes: body.break_minutes ?? body.breakMinutes,
      status: body.status,
      notes: body.notes,
    };
    if (body.breaks && body.breaks.length > 0) {
      backendBody.breaks = body.breaks.map((b) => ({
        id: b.id,
        duration_minutes: b.duration_minutes ?? b.durationMinutes,
      }));
    }

    const response = await apiPut<{ data: unknown }>(
      `/api/time-tracking/${encodeURIComponent(params.id)}`,
      token,
      backendBody,
    );
    return response.data;
  },
);
