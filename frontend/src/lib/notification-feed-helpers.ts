import type * as sharedContract from "./contract/shared.generated";
// Benachrichtigungs-Feed des Staff-Portals (#7148): Hinweise in der Glocke.
// Der Backend-Text (Titel, Text, Deep Link) entsteht beim Schreiben und kommt
// fertig an; das Frontend zeigt ihn nur an.

/**
 * Ein Eintrag, wie ihn die Feed-Routen der Portale liefern; im Träger-Portal
 * (#7146) mit der Schule des Eintrags.
 */
type FeedEntryAnswer = sharedContract.feedEntryResponse & {
  school_name?: string;
};

/** Eine Seite des Feeds; Go schreibt eine leere Liste als null. */
type FeedPageAnswer = Omit<sharedContract.feedPageResponse, "entries"> & {
  entries: readonly FeedEntryAnswer[] | null;
};

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
  wire: FeedEntryAnswer,
): NotificationFeedEntry {
  return {
    id: wire.id,
    type: wire.type,
    title: wire.title,
    body: wire.body,
    deepLink: wire.deep_link,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
    readAt: wire.read_at,
    ...(wire.school_name ? { schoolName: wire.school_name } : {}),
  };
}

export function mapNotificationFeedPage(
  wire: FeedPageAnswer,
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
  "meal_plan_changed",
  "school_closing_day_changed",
  "parent_school_closing_day_changed",
  "opening_change_changed",
  "parent_opening_change_changed",
  "room_closed",
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
