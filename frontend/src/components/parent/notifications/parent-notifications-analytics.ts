// Nutzungsanalyse der Glocke im Elternportal (#7140): dieselben drei
// Ereignisse wie im Staff-Portal, ohne Inhalte und ohne IDs. Eine Familie
// kann zu mehreren Schulen gehören; deshalb ohne Schule. Die Analyse lädt
// erst beim Ereignis, die Glocke steckt in jeder Seite des Portals.

import { NOTIFICATION_FEED_ANALYTICS_TYPES } from "~/lib/notification-feed-helpers";

const ANALYTICS_TYPES: ReadonlySet<string> = new Set(
  NOTIFICATION_FEED_ANALYTICS_TYPES,
);

export function trackParentBellOpened() {
  void import("~/lib/analytics").then(({ trackEvent }) =>
    trackEvent("notification_bell_opened"),
  );
}

export function trackParentFeedEntryClicked(type: string) {
  void import("~/lib/analytics").then(({ trackEvent }) =>
    trackEvent(
      "notification_feed_entry_clicked",
      ANALYTICS_TYPES.has(type) ? { notification_type: type } : undefined,
    ),
  );
}

export function trackParentFeedAllRead() {
  void import("~/lib/analytics").then(({ trackEvent }) =>
    trackEvent("notification_feed_all_read"),
  );
}
