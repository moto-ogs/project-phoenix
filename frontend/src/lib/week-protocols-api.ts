// Wochenprotokolle (#4769): je OGS-Gruppe und Woche ein Protokoll aus den
// Abenden der Woche. Das Backend hält jeden Abend den Tag fest, macht die
// Woche ab Freitagabend zum Entwurf und schließt ihn nach der Folgewoche
// selbst ab. Wer welches Protokoll sieht, entscheidet das Backend.

import { bffFileHref, bffJson } from "./bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type {
  weekProtocolDayResponse,
  weekProtocolResponse,
} from "./contract/week-protocols.generated";

export type WeekProtocolStatus = "collecting" | "draft" | "closed";
type WeekProtocolDayKind = "care" | "holiday" | "closing";

interface WeekProtocolMissingChild {
  studentId: string;
  name: string;
  reason: string;
  label: string;
}

export interface WeekProtocolBlock {
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  cancelReason: string;
}

interface WeekProtocolNotice {
  title: string;
  body: string;
}

export interface WeekProtocolDay {
  /** YYYY-MM-DD */
  date: string;
  /** False when the evening of the day was not recorded. */
  captured: boolean;
  kind: WeekProtocolDayKind | null;
  present: number;
  sick: number;
  excused: number;
  classTrip: number;
  absent: number;
  missing: WeekProtocolMissingChild[];
  blocks: WeekProtocolBlock[];
  notices: WeekProtocolNotice[];
  note: string;
}

export interface WeekProtocol {
  id: string;
  scope: "group" | "school";
  groupId: string | null;
  groupName: string;
  weekStart: string;
  weekEnd: string;
  status: WeekProtocolStatus;
  /** The Friday from which the week is a draft. */
  draftFrom: string;
  /** The Monday on which moto closes a draft nobody closed. */
  autoCloseOn: string;
  weekNote: string;
  closedAt: string | null;
  closedByName: string;
  closedAutomatically: boolean;
  /** Monday to Friday, and a weekend day only when it was recorded. */
  days: WeekProtocolDay[];
  /**
   * Read-state token of the detail read (ADR 0311); notes and closing send
   * it back. The list carries none.
   */
  version: string;
}

const DAY_KINDS: readonly WeekProtocolDayKind[] = [
  "care",
  "holiday",
  "closing",
];
const STATUSES: readonly WeekProtocolStatus[] = [
  "collecting",
  "draft",
  "closed",
];
const SCOPES: readonly WeekProtocol["scope"][] = ["group", "school"];

function mapDay(day: weekProtocolDayResponse): WeekProtocolDay {
  return {
    date: day.date,
    captured: day.captured,
    kind: knownEnum(DAY_KINDS, day.kind) ?? null,
    present: day.present,
    sick: day.sick,
    excused: day.excused,
    classTrip: day.class_trip,
    absent: day.absent,
    missing: (day.missing ?? []).map((child) => ({
      studentId: child.student_id,
      name: child.name,
      reason: child.reason,
      label: child.label,
    })),
    blocks: (day.blocks ?? []).map((block) => ({
      title: block.title,
      startTime: block.start_time,
      endTime: block.end_time,
      status: block.status,
      cancelReason: block.cancel_reason ?? "",
    })),
    notices: (day.notices ?? []).map((notice) => ({
      title: notice.title,
      body: notice.body ?? "",
    })),
    note: day.note,
  };
}

function mapWeekProtocol(data: weekProtocolResponse): WeekProtocol {
  return {
    id: data.id,
    scope: knownEnum(SCOPES, data.scope) ?? "group",
    groupId: data.group_id ?? null,
    groupName: data.group_name,
    weekStart: data.week_start,
    weekEnd: data.week_end,
    // An unknown state is read-only: it never offers editing.
    status: knownEnum(STATUSES, data.status) ?? "closed",
    draftFrom: data.draft_from,
    autoCloseOn: data.auto_close_on,
    weekNote: data.week_note,
    closedAt: data.closed_at ?? null,
    closedByName: data.closed_by_name ?? "",
    closedAutomatically: data.closed_automatically,
    days: (data.days ?? []).map(mapDay),
    version: data.version ?? "",
  };
}

/**
 * The notes of a draft: the week, and per day YYYY-MM-DD → text, with the
 * version of the protocol they were written on (ADR 0311).
 */
export interface WeekProtocolNotes {
  weekNote: string;
  days: Record<string, string>;
  expectedVersion: string;
}

/** The page of the weekly protocols, optionally of one group. */
export function weekProtocolsPath(groupId?: string | null): string {
  return groupId
    ? `/wochenprotokolle?group=${encodeURIComponent(groupId)}`
    : "/wochenprotokolle";
}

/** The page of one weekly protocol. */
export function weekProtocolPath(protocolId: string): string {
  return `/wochenprotokolle/${protocolId}`;
}

class WeekProtocolsService {
  async list(groupId?: string | null): Promise<WeekProtocol[]> {
    const protocols = await bffJson("tenant", "GET /api/week-protocols/", {
      query: { group_id: groupId || undefined },
      errorMessage: "Die Wochenprotokolle konnten nicht geladen werden.",
    });
    return protocols.map(mapWeekProtocol);
  }

  async get(protocolId: string): Promise<WeekProtocol> {
    return mapWeekProtocol(
      await bffJson("tenant", "GET /api/week-protocols/{protocolId}", {
        params: { protocolId },
        errorMessage: "Das Wochenprotokoll konnte nicht geladen werden.",
      }),
    );
  }

  async saveNotes(
    protocolId: string,
    notes: WeekProtocolNotes,
  ): Promise<WeekProtocol> {
    return mapWeekProtocol(
      await bffJson("tenant", "PUT /api/week-protocols/{protocolId}/notes", {
        params: { protocolId },
        body: {
          week_note: notes.weekNote,
          days: Object.entries(notes.days).map(([date, note]) => ({
            date,
            note,
          })),
          expected_version: notes.expectedVersion,
        },
        errorMessage: "Die Ergänzungen konnten nicht gespeichert werden.",
      }),
    );
  }

  /** Closes the protocol the person read; `expectedVersion` is its version. */
  async close(
    protocolId: string,
    expectedVersion: string,
  ): Promise<WeekProtocol> {
    return mapWeekProtocol(
      await bffJson("tenant", "POST /api/week-protocols/{protocolId}/close", {
        params: { protocolId },
        body: { expected_version: expectedVersion },
        errorMessage: "Das Wochenprotokoll konnte nicht abgeschlossen werden.",
      }),
    );
  }

  /** Same-origin proxy URL of the closed protocol as PDF. */
  pdfUrl(protocolId: string): string {
    return bffFileHref("tenant", "GET /api/week-protocols/{protocolId}/pdf", {
      params: { protocolId },
    });
  }
}

export const weekProtocolsService = new WeekProtocolsService();
