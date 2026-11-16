// Benachrichtigungs-Feed des Staff-Portals (#7148): Hinweise in der Glocke.
// Der Backend-Text (Titel, Text, Deep Link) entsteht beim Schreiben und kommt
// fertig an; das Frontend zeigt ihn nur an.

/** Ein Eintrag, wie ihn GET /api/notifications/feed liefert. */
export interface NotificationFeedEntryWire {
  id: number;
  type: string;
  title: string;
  body: string;
  deep_link: string;
  created_at: string;
  updated_at: string;
  read_at: string | null;
}

export interface NotificationFeedPageWire {
  entries: NotificationFeedEntryWire[];
  next_cursor: string | null;
  unread_count: number;
}

export interface NotificationFeedEntry {
  id: string;
  type: string;
  title: string;
  body: string;
  /** App-relativ, etwa `/mein-dienstplan?d=2026-11-20`. */
  deepLink: string;
  createdAt: string;
  /** Ein gebündelter Eintrag rückt mit der Aktualisierung nach oben. */
  updatedAt: string;
  /** Null, solange der Eintrag ungelesen ist. */
  readAt: string | null;
}

export interface NotificationFeedPage {
  entries: NotificationFeedEntry[];
  nextCursor: string | null;
  unreadCount: number;
}

export function mapNotificationFeedEntry(
  wire: NotificationFeedEntryWire,
): NotificationFeedEntry {
  return {
    id: wire.id.toString(),
    type: wire.type,
    title: wire.title,
    body: wire.body,
    deepLink: wire.deep_link,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
    readAt: wire.read_at ?? null,
  };
}

export function mapNotificationFeedPage(
  wire: NotificationFeedPageWire,
): NotificationFeedPage {
  return {
    entries: (wire.entries ?? []).map(mapNotificationFeedEntry),
    nextCursor: wire.next_cursor || null,
    unreadCount: wire.unread_count,
  };
}

/**
 * Feed-Typen, deren Name die Nutzungsanalyse als `notification_type`
 * annimmt. Der Filter in `analytics-policy.ts` liest dieselbe Liste; ein
 * neuer Typ kommt hier dazu, sonst fällt die Eigenschaft weg.
 */
export const NOTIFICATION_FEED_ANALYTICS_TYPES = [
  "instance_cancelled",
  "instance_reinstated",
] as const;
