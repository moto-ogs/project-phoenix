// GET /api/iot/device-slots: the school's Geräteplätze and how many of them
// its devices occupy (#2312). The static segment wins over /api/iot/[id].
import { apiGet } from "~/lib/api-helpers.server";
import { createGetHandler } from "~/lib/route-wrapper.server";
import {
  mapDeviceSlots,
  type BackendDeviceSlots,
  type DeviceSlots,
} from "~/lib/device-slots";

export const GET = createGetHandler(
  async (_request, token): Promise<DeviceSlots> => {
    const response = await apiGet<{ data: BackendDeviceSlots }>(
      "/api/iot/device-slots",
      token,
    );
    return mapDeviceSlots(response.data);
  },
);
