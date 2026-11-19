import {
  createGetHandler,
  createPutHandler,
  createDeleteHandler,
} from "@/lib/route-wrapper.server";
import { apiGet, apiPut, apiDelete } from "~/lib/api-helpers.server";
import type { DeviceResponse } from "~/lib/contract/iot.generated";
import { mapDeviceResponse } from "@/lib/iot-helpers";

/**
 * Temporary (#7563): GET, PUT and DELETE /api/iot/{id} are registered in the
 * contract, and the portal's catalog proxy answers them once this file is
 * gone. It stays one release for an installed app with an older bundle; the
 * current client reads both shapes. Delete this file after the next
 * production deploy.
 */

export const GET = createGetHandler(async (request, token, params) => {
  const id = params.id as string;
  const response = await apiGet<{ data: DeviceResponse }>(
    `/api/iot/${encodeURIComponent(id)}`,
    token,
  );

  if (!response?.data) {
    throw new Error("Device not found");
  }

  return mapDeviceResponse(response.data);
});

export const PUT = createPutHandler(async (request, body, token, params) => {
  const id = params.id as string;
  const response = await apiPut<{ data: DeviceResponse }>(
    `/api/iot/${encodeURIComponent(id)}`,
    token,
    body,
  );

  if (!response?.data) {
    throw new Error("Failed to update device");
  }

  return mapDeviceResponse(response.data);
});

export const DELETE = createDeleteHandler(async (request, token, params) => {
  const id = params.id as string;
  await apiDelete(`/api/iot/${encodeURIComponent(id)}`, token);

  // Return success response for delete operations
  return { success: true, message: "Device deleted successfully" };
});
