/**
 * „Heute anders“ (#7659): die Änderungen am Regelbetrieb der Schule für
 * heute. Das Backend liefert strukturierte Einträge ohne fertige Texte und
 * einen Status pro Quelle; die Texte baut `day-changes-text.ts`.
 */
import { bffJson } from "~/lib/bff-fetch";
import type {
  Child,
  ChildStatus,
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

export interface DayChange {
  readonly kind: Kind | (string & {});
  readonly section: Section | (string & {});
  readonly halfDay: boolean;
  /** Erster Tag einer Änderung, die vor heute begann („seit“). */
  readonly since: string | null;
  /** Letzter Tag einer Änderung, die über heute hinausgeht („bis“). */
  readonly until: string | null;
  readonly people: readonly DayChangePerson[];
  readonly groupName: string | null;
  readonly link: DayChangeLink | null;
  readonly count: number | null;
  readonly child?: DayChangeChild | null;
  readonly childSummary?: DayChangeChildSummary | null;
}

export interface DayChangesOverview {
  readonly date: string;
  /** Quellen, die gerade nicht geladen werden konnten. */
  readonly failedSources: readonly (Source | (string & {}))[];
  readonly entries: readonly DayChange[];
}

function mapLink(link: Entry["link"]): DayChangeLink | null {
  return link
    ? {
        target: link.target,
        staffId: link.staff_id ?? null,
        studentId: link.student_id ?? null,
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

function mapEntry(entry: Entry): DayChange {
  return {
    kind: entry.kind,
    section: entry.section,
    halfDay: entry.half_day,
    since: entry.since,
    until: entry.until,
    people: (entry.people ?? []).map((person) => ({
      staffId: person.staff_id,
      name: person.name,
      role: person.role,
      isSelf: person.is_self,
    })),
    groupName: entry.group?.name ?? null,
    link: mapLink(entry.link),
    count: entry.count,
    child: entry.child ? mapChild(entry.child) : null,
    childSummary: entry.child_summary
      ? mapChildSummary(entry.child_summary)
      : null,
  };
}

function mapDayChanges(overview: Overview): DayChangesOverview {
  return {
    date: overview.date ?? "",
    failedSources: (overview.sources ?? [])
      .filter((source) => source.status === "failed")
      .map((source) => source.source),
    entries: (overview.entries ?? []).map(mapEntry),
  };
}

/** Liest die Übersicht der Sitzung über den Proxy des Staff-Portals. */
export async function fetchDayChanges(): Promise<DayChangesOverview> {
  return mapDayChanges(await bffJson<Overview>("/api/day-changes/today"));
}
