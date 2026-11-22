"use client";

// Welches Portal die Glocke bedient (#7148, #7139, #7146, #7147). Staff-Portal,
// moto schule, Träger- und Caterer-Portal zeigen den Feed des Kontos, jeweils über die eigene
// BFF-Route, unter eigenen SWR-Schlüsseln und mit den Links des eigenen
// Portals. Ohne Anbieter gilt das Staff-Portal.

import { createContext, useContext } from "react";

import {
  type NotificationFeedApi,
  tenantNotificationFeedApi,
} from "./notification-feed-api";

export interface NotificationFeedPortal {
  /** Die Feed-Aufrufe des Portals. */
  readonly api: NotificationFeedApi;
  /** Unterscheidet die SWR-Schlüssel der Portale. */
  readonly keyScope: "staff" | "school" | "traeger" | "caterer";
  /** Macht aus dem Link eines Eintrags den Pfad für den Router. */
  readonly resolveLink: (link: string) => string;
  /**
   * Schule für die Nutzungsanalyse. `undefined`: aus dem Tenant-Kontext
   * (Staff-Portal); `null`: nichts erfassen.
   */
  readonly analyticsSchoolId?: string | null;
}

const STAFF_NOTIFICATION_FEED_PORTAL: NotificationFeedPortal = {
  api: tenantNotificationFeedApi,
  keyScope: "staff",
  resolveLink: (link) => link,
};

const NotificationFeedPortalContext = createContext<NotificationFeedPortal>(
  STAFF_NOTIFICATION_FEED_PORTAL,
);

export const NotificationFeedPortalProvider =
  NotificationFeedPortalContext.Provider;

export function useNotificationFeedPortal(): NotificationFeedPortal {
  return useContext(NotificationFeedPortalContext);
}
