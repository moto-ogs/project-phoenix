// Client API of the Gerätesperre (#2317) in the school portal. The request
// goes through the session-authenticated proxy under /api/iot.
import { apiErrorFromResponse, transportFetch } from "./api-error";

/** Blocks or unblocks one device, addressed by its hardware device ID. */
export async function setDeviceBlocked(
  deviceId: string,
  blocked: boolean,
): Promise<void> {
  const response = await transportFetch(
    `/api/iot/${encodeURIComponent(deviceId)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: blocked ? "inactive" : "active" }),
    },
  );
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `device status update failed (${response.status})`,
    );
  }
}
