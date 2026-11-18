// PATCH /api/iot/{deviceId}/status: blocks ("inactive") or unblocks
// ("active") a school's device (Gerätesperre, #2317). The segment carries
// the hardware device ID, as the backend route does; the backend validates
// the status.
import { apiPatch } from "~/lib/api-helpers.server";
import { createPatchHandler } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

interface DeviceStatusRequest {
  status: string;
}

export const PATCH = createPatchHandler<null, DeviceStatusRequest>(
  async (_request, body, token, params) => {
    await apiPatch<unknown, DeviceStatusRequest>(
      `/api/iot/${requirePathSegmentParam(params)}/status`,
      token,
      { status: body.status },
    );
    return null;
  },
);
