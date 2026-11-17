import type { NextRequest } from "next/server";
import { apiGet } from "~/lib/api-helpers.server";
import { createGetHandler } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

/**
 * Proxy GET /api/parent-announcements/students/{studentId} → backend.
 *
 * Kinderakte (#4814): die Elternbriefe, die das Kind erreicht haben, mit
 * Lesebestätigung, und die Einverständnisse des Kindes mit Stand.
 */
export const GET = createGetHandler(
  async (
    _request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const response = await apiGet<{ data: unknown }>(
      `/api/parent-announcements/students/${requirePathSegmentParam(params, "studentId")}`,
      token,
    );
    return response.data;
  },
);
