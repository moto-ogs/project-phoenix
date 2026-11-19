import type { NextRequest } from "next/server";
import {
  createGetHandler,
  createPostHandler,
} from "@/lib/route-wrapper.server";
import { apiGet, apiPost } from "~/lib/api-helpers.server";
import type { DeviceResponse } from "~/lib/contract/iot.generated";
import type { Device } from "@/lib/iot-helpers";
import { mapDeviceResponse } from "@/lib/iot-helpers";

/**
 * Temporary (#7563): GET and POST /api/iot/ are registered in the contract,
 * and the portal's catalog proxy answers them once this file is gone. It
 * stays one release for an installed app with an older bundle, which reads
 * the list as mapped devices inside a second envelope with pagination; the
 * current client reads both shapes. The kiosk's device API is not served
 * here. Delete this file after the next production deploy.
 */

/**
 * Type definition for paginated response that the database page expects
 */
interface PaginatedDevicesResponse {
  data: Device[];
  pagination: {
    current_page: number;
    page_size: number;
    total_pages: number;
    total_records: number;
  };
}

export const GET = createGetHandler(
  async (
    request: NextRequest,
    token: string,
  ): Promise<PaginatedDevicesResponse> => {
    const response = await apiGet<{ data: DeviceResponse[] }>(
      "/api/iot",
      token,
    );

    if (!response?.data || !Array.isArray(response.data)) {
      return {
        data: [],
        pagination: {
          current_page: 1,
          page_size: 50,
          total_pages: 0,
          total_records: 0,
        },
      };
    }

    const mappedDevices = response.data.map((device: DeviceResponse) =>
      mapDeviceResponse(device),
    );

    return {
      data: mappedDevices,
      pagination: {
        current_page: 1,
        page_size: mappedDevices.length,
        total_pages: 1,
        total_records: mappedDevices.length,
      },
    };
  },
);

export const POST = createPostHandler(async (request, body, token) => {
  const response = await apiPost<{ data: DeviceResponse }>(
    "/api/iot",
    token,
    body,
  );

  if (!response?.data) {
    throw new Error("Invalid response format");
  }

  return mapDeviceResponse(response.data);
});
