/**
 * „Heute anders“ (#7659): die Änderungen am Regelbetrieb der Schule für
 * heute. Das Backend liefert strukturierte Einträge ohne fertige Texte und
 * einen Status pro Quelle; die Texte baut `day-changes-text.ts`.
 */
import { bffJson } from "~/lib/bff-fetch";
import type {
  Child,
  ChildStatus,
  DayNotice,
  Entry,
  Kind,
  LinkTarget,
  Overview,
  PersonRole,
  Section,
  Source,
} from "~/lib/contract/day-changes.generated";

export interface DayChangePerson {
  readonly staffId: string;
  readonly name: string;
  readonly role: PersonRole | (string & {});
  readonly isSelf: boolean;
}

/** Das Kind eines Eintrags und was heute anders ist (#7665). */
export interface DayChangeChild {
  readonly studentId: string;
  readonly name: string;
  /** Bei `child_absent`: krank oder entschuldigt. */
  readonly status: ChildStatus | (string & {}) | null;
  /** Bei `child_pickup_changed`: „14:30“; null heißt, es kommt heute nicht. */
  readonly pickupTime: string | null;
  /** Bei `child_pickup_note`: der Hinweis zum Abholen. */
  readonly note: string | null;
}

export interface DayChangeLink {
  readonly target: LinkTarget | (string & {});
  readonly staffId: string | null;
  readonly studentId?: string | null;
  /** Der Termin im Vertretungsplan (#7675). */
  readonly instanceId?: string | null;
  /** Der Tag der Übersicht, für den Vertretungsplan dieses Tages. */
  readonly day?: string | null;
}

/** Die Kinder einer Gruppe oder Klasse außerhalb der eigenen Gruppen. */
export interface DayChangeChildSummary {
  readonly schoolClass: string;
  readonly counts: {
    readonly sick: number;
    readonly excused: number;
    readonly pickupChanged: number;
    readonly goesAlone: number;
    readonly pickupNote: number;
  };
  readonly items: readonly {
    readonly kind: Kind | (string & {});
    readonly child: DayChangeChild;
    readonly link: DayChangeLink | null;
  }[];
}

/** Ein Hinweis der Leitung (#7667); Titel und Text schreibt die Leitung. */
export interface DayChangeNotice {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly important: boolean;
  readonly requiresAcknowledgement: boolean;
  /** Die eigene Kenntnisnahme ist gespeichert. */
  readonly acknowledged: boolean;
}

export interface DayChange {
  readonly kind: Kind | (string & {});
  readonly section: Section | (string & {});
  readonly halfDay: boolean;
  /** Erster Tag einer Änderung, die vor heute begann („seit“). */
  readonly since: string | null;
  /** Letzter Tag einer Änderung, die über heute hinausgeht („bis“). */
  readonly until: string | null;
  /**
   * Beginn und Ende als Zeitpunkt bei einer Änderung mit Uhrzeit (ein Dienst,
   * #7661, #7660), sonst null. Ist das Ende vorbei, steht sie unter „erledigt“.
   */
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly people: readonly DayChangePerson[];
  readonly groupName: string | null;
  readonly link: DayChangeLink | null;
  readonly count: number | null;
  readonly child?: DayChangeChild | null;
  readonly childSummary?: DayChangeChildSummary | null;
  /** Nur bei der Art `staff_notice`. */
  readonly notice?: DayChangeNotice | null;
  /** Der Schließtag (#7664): sein Name und ob der Träger ihn plant. */
  readonly closing?: {
    readonly name: string;
    readonly traeger: boolean;
  } | null;
  /**
   * Der Termin eines Eintrags der Quelle Stundenplan (#7662) oder einer
   * Abwesenheit oder Vertretung bei einem Termin (#7675).
   */
  readonly activity?: { readonly id: string; readonly title: string } | null;
  /** Wo der Termin heute ist. */
  readonly roomName?: string | null;
  /** Wo der Termin sonst ist, wenn er heute in einem anderen Raum liegt. */
  readonly previousRoomName?: string | null;
  /**
   * Die Klasse eines Ausflugs oder eines geänderten Unterrichtsschlusses
   * (#7681): ihr Name, die Uhrzeit („13:00“, Rückkehr oder Schluss) und bei
   * einem Ausflug die Zahl der Kinder.
   */
  readonly schoolClass?: {
    readonly name: string;
    readonly time: string | null;
    readonly children: number;
  } | null;
}

export interface DayChangesOverview {
  readonly date: string;
  /** Quellen, die gerade nicht geladen werden konnten. */
  readonly failedSources: readonly (Source | (string & {}))[];
  readonly entries: readonly DayChange[];
}

function mapLink(link: Entry["link"], day?: string): DayChangeLink | null {
  return link
    ? {
        target: link.target,
        staffId: link.staff_id ?? null,
        studentId: link.student_id ?? null,
        instanceId: link.instance_id ?? null,
        day: day ?? null,
      }
    : null;
}

function mapChild(child: Child): DayChangeChild {
  return {
    studentId: child.student_id,
    name: `${child.first_name} ${child.last_name}`.trim(),
    status: child.status,
    pickupTime: child.pickup_time,
    note: child.note,
  };
}

function mapChildSummary(
  summary: NonNullable<Entry["child_summary"]>,
): DayChangeChildSummary {
  return {
    schoolClass: summary.school_class,
    counts: {
      sick: summary.counts.sick,
      excused: summary.counts.excused,
      pickupChanged: summary.counts.pickup_changed,
      goesAlone: summary.counts.goes_alone,
      pickupNote: summary.counts.pickup_note,
    },
    items: (summary.items ?? []).map((item) => ({
      kind: item.kind,
      child: mapChild(item.child),
      link: mapLink(item.link),
    })),
  };
}

function mapNotice(notice: DayNotice | null): DayChangeNotice | null {
  if (!notice) return null;
  return {
    id: notice.id,
    title: notice.title,
    body: notice.body,
    important: notice.priority === "important",
    requiresAcknowledgement: notice.requires_acknowledgement,
    acknowledged: notice.acknowledged,
  };
}

function mapEntry(entry: Entry, day: string): DayChange {
  return {
    kind: entry.kind,
    section: entry.section,
    halfDay: entry.half_day,
    since: entry.since,
    until: entry.until,
    startsAt: entry.starts_at,
    endsAt: entry.ends_at,
    people: (entry.people ?? []).map((person) => ({
      staffId: person.staff_id,
      name: person.name,
      role: person.role,
      isSelf: person.is_self,
    })),
    groupName: entry.group?.name ?? null,
    link: mapLink(entry.link, day),
    count: entry.count,
    child: entry.child ? mapChild(entry.child) : null,
    childSummary: entry.child_summary
      ? mapChildSummary(entry.child_summary)
      : null,
    notice: mapNotice(entry.notice ?? null),
    closing: entry.closing
      ? { name: entry.closing.name, traeger: entry.closing.traeger }
      : null,
    activity: entry.activity
      ? { id: entry.activity.id, title: entry.activity.title }
      : null,
    roomName: entry.room?.name ?? null,
    previousRoomName: entry.previous_room?.name ?? null,
    schoolClass: entry.class
      ? {
          name: entry.class.name,
          time: entry.class.time,
          children: entry.class.children,
        }
      : null,
  };
}

function mapDayChanges(overview: Overview): DayChangesOverview {
  return {
    date: overview.date ?? "",
    failedSources: (overview.sources ?? [])
      .filter((source) => source.status === "failed")
      .map((source) => source.source),
    entries: (overview.entries ?? []).map((entry) =>
      mapEntry(entry, overview.date ?? ""),
    ),
  };
}

/** Liest die Übersicht der Sitzung über den Proxy des Staff-Portals. */
export async function fetchDayChanges(): Promise<DayChangesOverview> {
  return mapDayChanges(await bffJson("tenant", "GET /api/day-changes/today"));
}
