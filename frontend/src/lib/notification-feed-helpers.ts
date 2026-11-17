// Benachrichtigungs-Feed des Staff-Portals (#7148): Hinweise in der Glocke.
// Der Backend-Text (Titel, Text, Deep Link) entsteht beim Schreiben und kommt
// fertig an; das Frontend zeigt ihn nur an.

/**
 * Ein Eintrag, wie ihn GET /api/notifications/feed liefert. Der Portal-Proxy
 * (#2352) reicht die ID als String durch, das Elternportal noch als Zahl.
 */
export interface NotificationFeedEntryWire {
  id: string | number;
  type: string;
  title: string;
  body: string;
  deep_link: string;
  created_at: string;
  updated_at: string;
  read_at: string | null;
  /** Nur im Träger-Portal (#7146): die Schule des Eintrags. */
  school_name?: string;
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
  /**
   * Die Schule des Eintrags, wo eine Glocke mehrere Schulen zeigt
   * (Träger-Portal, #7146); sonst null.
   */
  schoolName?: string | null;
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
    schoolName: wire.school_name || null,
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
  "parent_care_cancelled",
  "school_closing_day_changed",
  "parent_school_closing_day_changed",
  "staffing_changed",
  "group_staffing_changed",
  "team_member_absent",
  "class_timetable_changed",
  "parent_class_timetable_changed",
  "instance_reinstated",
  "instance_room_changed",
  "instance_room_changed_later",
  "parent_room_changed",
  "parent_room_changed_later",
  "staff_notice_published",
  "student_pickup_changed",
  "student_absence_reported",
  "staff_student_note_shared",
  "staff_survey",
  "staff_planned_exit",
  "staff_qualification_expiry",
  "staff_qualification_own_expiry",
] as const;
