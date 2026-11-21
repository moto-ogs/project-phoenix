// Types + mappers for the student attendance-history API.
//
// The backend returns ISO timestamps in snake_case; this module normalises
// them to camelCase `Date`-friendly shapes used by the UI.

import { formatBerlinTime } from "~/lib/date-helpers";
import {
  parseAttendanceActor,
  type AttendanceActor,
} from "~/lib/attendance-actor";
import { knownEnum } from "~/lib/contract/known-enum";
import type {
  attendanceDayRecord,
  attendanceHistoryDay,
  attendanceHistoryResponse,
  attendanceSessionRecord,
  attendanceSlotEntry,
  attendanceStatusEntry,
  attendanceVisitEntry,
} from "~/lib/contract/students.generated";

export type AttendanceSlotStatus = "expected" | "present" | "absent";
type ActivityInstanceStatus = "planned" | "active" | "completed" | "cancelled";

const SLOT_STATUSES: readonly AttendanceSlotStatus[] = [
  "expected",
  "present",
  "absent",
];
const INSTANCE_STATUSES: readonly ActivityInstanceStatus[] = [
  "planned",
  "active",
  "completed",
  "cancelled",
];

// Wire types: the decoded response of the catalog proxy (#2353).
export type AttendanceHistoryWire = attendanceHistoryResponse;
type AttendanceHistoryDayWire = attendanceHistoryDay;
type AttendanceRecordWire = attendanceDayRecord;
type AttendanceSessionWire = attendanceSessionRecord;
type AttendanceSlotWire = attendanceSlotEntry;
type AttendanceVisitWire = attendanceVisitEntry;
type AttendanceStatusEntryWire = attendanceStatusEntry;

// --- UI-friendly shapes ---

export interface AttendanceHistory {
  studentId: string;
  days: AttendanceHistoryDay[];
  range: { start: Date; end: Date };
  clamped: boolean;
  caps: { attendanceDays: number; roomDetailDays: number };
}

export interface AttendanceHistoryDay {
  date: string; // YYYY-MM-DD
  attendance: AttendanceRecord | null;
  statusEntries: AttendanceStatusEntry[];
  roomDetailAvailable: boolean;
  visits: AttendanceVisit[];
  slots: AttendanceSlot[];
}

interface AttendanceRecord {
  checkInTime: Date;
  checkOutTime: Date | null;
  durationMinutes: number | null;
  checkedInBy: string;
  checkedOutBy: string | null;
  /** Who recorded the day's arrival and pickup (#4761). */
  checkedInActor: AttendanceActor | null;
  checkedOutActor: AttendanceActor | null;
  deviceId: string;
  sessions: AttendanceSession[];
  /**
   * Reasons staff left when the child went home early (#3324), in the order
   * of the day's stays; null when nobody wrote one.
   */
  checkOutNote: string | null;
  /** When the child left for class (#5656): no departures, the day's stays. */
  leftForClassAt: Date[];
}

interface AttendanceSession {
  checkInTime: Date;
  checkOutTime: Date | null;
  durationMinutes: number | null;
  checkOutNote: string | null;
}

interface AttendanceSlot {
  instanceId: string;
  instanceStatus: ActivityInstanceStatus | null;
  title: string;
  startTime: string;
  endTime: string;
  /** undefined: a status this build does not know; the row shows „–“. */
  status: AttendanceSlotStatus | undefined;
  substatus: string | null;
  note: string | null;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  isUnplanned: boolean;
}

interface AttendanceVisit {
  roomId: string | null;
  roomName: string;
  entryTime: Date;
  exitTime: Date | null;
  durationMinutes: number | null;
}

interface AttendanceStatusEntry {
  status: string;
  label: string;
  reportedAt: Date;
  clearedAt: Date | null;
}

export function mapAttendanceHistoryResponse(
  raw: AttendanceHistoryWire,
): AttendanceHistory {
  return {
    studentId: raw.student_id,
    days: (raw.days ?? []).map(mapAttendanceHistoryDay),
    range: {
      start: new Date(raw.range.start),
      end: new Date(raw.range.end),
    },
    clamped: raw.clamped,
    caps: {
      attendanceDays: raw.caps.attendance_days,
      roomDetailDays: raw.caps.room_detail_days,
    },
  };
}

function mapAttendanceHistoryDay(
  day: AttendanceHistoryDayWire,
): AttendanceHistoryDay {
  return {
    date: day.date,
    attendance: day.attendance ? mapAttendanceRecord(day.attendance) : null,
    statusEntries: (day.status_entries ?? []).map(mapAttendanceStatusEntry),
    roomDetailAvailable: day.room_detail_available,
    visits: (day.visits ?? []).map(mapAttendanceVisit),
    slots: (day.slots ?? []).map(mapAttendanceSlot),
  };
}

function mapAttendanceRecord(rec: AttendanceRecordWire): AttendanceRecord {
  const sessions = (rec.sessions ?? [rec]).map(mapAttendanceSession);
  const notes = sessions
    .map((session) => session.checkOutNote)
    .filter((note): note is string => Boolean(note));
  return {
    checkInTime: new Date(rec.check_in_time),
    checkOutTime: rec.check_out_time ? new Date(rec.check_out_time) : null,
    durationMinutes: rec.duration_minutes ?? null,
    checkedInBy: rec.checked_in_by,
    checkedOutBy: rec.checked_out_by ?? null,
    checkedInActor: parseAttendanceActor(rec.checked_in_actor),
    checkedOutActor: parseAttendanceActor(rec.checked_out_actor),
    deviceId: rec.device_id,
    sessions,
    checkOutNote: notes.length > 0 ? notes.join(" · ") : null,
    leftForClassAt: (rec.sessions ?? []).flatMap((session) =>
      session.check_out_reason === "class" && session.check_out_time
        ? [new Date(session.check_out_time)]
        : [],
    ),
  };
}

function mapAttendanceSession(
  session: AttendanceSessionWire,
): AttendanceSession {
  return {
    checkInTime: new Date(session.check_in_time),
    checkOutTime: session.check_out_time
      ? new Date(session.check_out_time)
      : null,
    durationMinutes: session.duration_minutes ?? null,
    checkOutNote: session.check_out_note ?? null,
  };
}

function mapAttendanceSlot(slot: AttendanceSlotWire): AttendanceSlot {
  return {
    instanceId: slot.instance_id,
    instanceStatus: knownEnum(INSTANCE_STATUSES, slot.instance_status) ?? null,
    title: slot.title,
    startTime: slot.start_time,
    endTime: slot.end_time,
    status: knownEnum(SLOT_STATUSES, slot.status),
    substatus: slot.substatus ?? null,
    note: slot.note ?? null,
    checkedInAt: slot.checked_in_at ? new Date(slot.checked_in_at) : null,
    checkedOutAt: slot.checked_out_at ? new Date(slot.checked_out_at) : null,
    isUnplanned: slot.is_unplanned,
  };
}

function mapAttendanceVisit(v: AttendanceVisitWire): AttendanceVisit {
  return {
    roomId: v.room_id ?? null,
    roomName: v.room_name ?? "",
    entryTime: new Date(v.entry_time),
    exitTime: v.exit_time ? new Date(v.exit_time) : null,
    durationMinutes: v.duration_minutes ?? null,
  };
}

function mapAttendanceStatusEntry(
  entry: AttendanceStatusEntryWire,
): AttendanceStatusEntry {
  return {
    status: entry.status,
    label: entry.label,
    reportedAt: new Date(entry.reported_at),
    clearedAt: entry.cleared_at ? new Date(entry.cleared_at) : null,
  };
}

// --- Formatting helpers ---

/** School wall-clock time ("08:15") in Europe/Berlin, whatever the browser's zone (#6471). */
export function formatTime(d: Date): string {
  // toISOString() throws on an invalid Date; the row shows the empty glyph.
  if (Number.isNaN(d.getTime())) return "–";
  return formatBerlinTime(d.toISOString());
}

export function formatAttendanceSlotStatus(
  status: AttendanceSlotStatus | undefined,
  substatus?: string | null,
): string {
  if (status === undefined) return "–";
  if (status === "present") return "Anwesend";
  if (substatus === "sick") return "Krank";
  if (substatus === "excused") return "Entschuldigt";
  if (substatus === "field_trip") return "Klassenfahrt";
  if (status === "absent") return "Abwesend";
  return "Erwartet";
}

export function formatDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatDuration(minutes: number | null): string {
  if (minutes == null) return "–";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
