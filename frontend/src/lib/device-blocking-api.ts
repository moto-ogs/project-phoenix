// Client API of the Gerätesperre (#2317) in the school portal. The request
// goes through the session-authenticated proxy under /api/iot.
import { bffJson } from "./bff-fetch";

/** Blocks or unblocks one device, addressed by its hardware device ID. */
export async function setDeviceBlocked(
  deviceId: string,
  blocked: boolean,
): Promise<void> {
  await bffJson("tenant", "PATCH /api/iot/{deviceId}/status", {
    params: { deviceId },
    body: { status: blocked ? "inactive" : "active" },
    errorMessage: "device status update failed",
  });
}
