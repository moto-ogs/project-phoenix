// GET /api/iot/{id}/history: the history of one of the school's devices
// (Gerätelebenszyklus, #2321), newest first. The backend answers only the
// signed-in school's devices and names its staff.
import { apiGet } from "~/lib/api-helpers.server";
import { createGetHandler } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

interface DeviceHistoryEntry {
  id: string;
  action: string;
  actor_kind: string;
  actor_name: string | null;
  changes: Record<string, { before: string | null; after: string | null }>;
  occurred_at: string;
}

export const GET = createGetHandler(async (_request, token, params) => {
  const response = await apiGet<{ data: DeviceHistoryEntry[] | null }>(
    `/api/iot/${requirePathSegmentParam(params)}/history`,
    token,
  );
  return response?.data ?? [];
});
