import { bffJson } from "./bff-fetch";

const TEST_FAILED = "Test notification failed";

/**
 * Sends a fixed test notification to the logged-in account. The school
 * portal (#2208) reaches the same handler through its own session.
 *
 * Throws an ApiError (#2517): a school with notifications switched off
 * answers communication.notifications_disabled, a request that never reached
 * the API general.unavailable. The card shows the catalog text.
 */
export async function sendTestNotification(
  portal: "tenant" | "school" = "tenant",
): Promise<void> {
  if (portal === "school") {
    await bffJson("school", "POST /school/notifications/test", {
      errorMessage: TEST_FAILED,
    });
    return;
  }
  await bffJson("tenant", "POST /api/notifications/test", {
    errorMessage: TEST_FAILED,
  });
}
