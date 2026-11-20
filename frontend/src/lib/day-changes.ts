/**
 * „Heute anders“ (#7659): die Änderungen am Regelbetrieb der Schule für
 * heute. Das Backend liefert strukturierte Einträge ohne fertige Texte und
 * einen Status pro Quelle; die Texte baut `day-changes-text.ts`.
 */
import { bffJson } from "~/lib/bff-fetch";
import type {
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
  readonly link: {
    readonly target: LinkTarget | (string & {});
    readonly staffId: string | null;
  } | null;
  readonly count: number | null;
  /** Der Termin eines Eintrags der Quelle Stundenplan (#7662), sonst null. */
  readonly activity: {
    readonly id: string;
    readonly title: string;
    /** „HH:MM“ */
    readonly startTime: string;
    readonly endTime: string;
  } | null;
  /** Wo der Termin heute ist. */
  readonly roomName: string | null;
  /** Wo der Termin sonst ist, wenn er heute in einem anderen Raum liegt. */
  readonly previousRoomName: string | null;
}

export interface DayChangesOverview {
  readonly date: string;
  /** Quellen, die gerade nicht geladen werden konnten. */
  readonly failedSources: readonly (Source | (string & {}))[];
  readonly entries: readonly DayChange[];
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
    link: entry.link
      ? { target: entry.link.target, staffId: entry.link.staff_id ?? null }
      : null,
    count: entry.count,
    activity: entry.activity
      ? {
          id: entry.activity.id,
          title: entry.activity.title,
          startTime: entry.activity.start_time,
          endTime: entry.activity.end_time,
        }
      : null,
    roomName: entry.room?.name ?? null,
    previousRoomName: entry.previous_room?.name ?? null,
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
