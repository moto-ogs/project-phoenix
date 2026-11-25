/**
 * Client for the per-account notification consent API.
 *
 * Mirrors push-api.ts: it throws an ApiError on failure, which the card shows
 * on the shared error path (#2517).
 */
import { bffJson } from "./bff-fetch";
import type * as sharedContract from "./contract/shared.generated";

export type PreferencePortal = "tenant" | "parent" | "school";

/**
 * The catalogue of one account. `tenant_enabled` mirrors the school-wide
 * switch (false: nothing is delivered at all); `types` is a list also when Go
 * sends `null`.
 */
export type NotificationPreferences = Omit<
  sharedContract.PreferenceOverview,
  "types"
> & {
  types: sharedContract.PreferenceState[];
};

const FAILED = "Einstellung konnte nicht geladen werden.";

async function loadOverview(
  portal: PreferencePortal,
): Promise<sharedContract.PreferenceOverview> {
  switch (portal) {
    case "parent":
      return bffJson("parent", "GET /parent/me/notification-preferences/", {
        errorMessage: FAILED,
      });
    case "school":
      return bffJson("school", "GET /school/notifications/preferences/", {
        errorMessage: FAILED,
      });
    default:
      return bffJson("tenant", "GET /api/notifications/preferences/", {
        errorMessage: FAILED,
      });
  }
}

export async function fetchNotificationPreferences(
  portal: PreferencePortal = "tenant",
): Promise<NotificationPreferences> {
  return mapNotificationPreferences(await loadOverview(portal));
}

export function mapNotificationPreferences(
  overview: sharedContract.PreferenceOverview,
): NotificationPreferences {
  return { ...overview, types: overview.types ?? [] };
}

export async function setNotificationPreference(
  type: string,
  enabled: boolean,
  portal: PreferencePortal = "tenant",
): Promise<void> {
  const options = {
    params: { type },
    body: { enabled },
    errorMessage: FAILED,
  };
  switch (portal) {
    case "parent":
      await bffJson(
        "parent",
        "PUT /parent/me/notification-preferences/{type}",
        options,
      );
      return;
    case "school":
      await bffJson(
        "school",
        "PUT /school/notifications/preferences/{type}",
        options,
      );
      return;
    default:
      await bffJson(
        "tenant",
        "PUT /api/notifications/preferences/{type}",
        options,
      );
  }
}

export async function disableAllNotificationPreferences(
  portal: PreferencePortal = "tenant",
): Promise<void> {
  const options = { errorMessage: FAILED };
  switch (portal) {
    case "parent":
      await bffJson(
        "parent",
        "DELETE /parent/me/notification-preferences/",
        options,
      );
      return;
    case "school":
      await bffJson(
        "school",
        "DELETE /school/notifications/preferences/",
        options,
      );
      return;
    default:
      await bffJson(
        "tenant",
        "DELETE /api/notifications/preferences/",
        options,
      );
  }
}

/**
 * Opt-in e-mails to staff (#3780), decided where their event happens rather
 * than on the profile page. The backend checks the type's permission.
 */
export async function fetchEmailSubscription(type: string): Promise<boolean> {
  const subscription = await bffJson(
    "tenant",
    "GET /api/notifications/email-subscriptions/{type}",
    { params: { type }, errorMessage: FAILED },
  );
  return subscription.enabled;
}

export async function setEmailSubscription(
  type: string,
  enabled: boolean,
): Promise<void> {
  await bffJson("tenant", "PUT /api/notifications/email-subscriptions/{type}", {
    params: { type },
    body: { enabled },
    errorMessage: FAILED,
  });
}
