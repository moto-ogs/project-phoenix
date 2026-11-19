// GET /api/iot/device-slots: the school's Geräteplätze and how many of them
// its devices occupy (#2312). The static segment wins over /api/iot/[id].
//
// Temporary (#7563): the route is registered in the contract, and the
// portal's catalog proxy answers it once this file is gone. It stays one
// release for an installed app with an older bundle, which reads the mapped
// camelCase shape; the current client reads both shapes. Delete this file
// after the next production deploy.
import type { DeviceSlotsResponse } from "~/lib/contract/iot.generated";
import { apiGet } from "~/lib/api-helpers.server";
import { createGetHandler } from "~/lib/route-wrapper.server";
import { mapDeviceSlots, type DeviceSlots } from "~/lib/device-slots";

export const GET = createGetHandler(
  async (_request, token): Promise<DeviceSlots> => {
    const response = await apiGet<{ data: DeviceSlotsResponse }>(
      "/api/iot/device-slots",
      token,
    );
    return mapDeviceSlots(response.data);
  },
);
