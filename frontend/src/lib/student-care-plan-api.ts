/**
 * Client for the per-child derived care plan (Betreuungsplan) endpoints.
 *
 * Mirrors the Go DTOs in backend/api/timetable/student_day_shapes.go. Backend
 * int64 IDs become frontend strings; snake_case becomes camelCase via the
 * mappers below. The plan is READ-ONLY here — it is the resolved arrival →
 * activities → pickup shape for one student on one day, with per-child
 * attendance. Free-care time and broad day deviations are composed on top in
 * care-plan-helpers.ts and the view, not by this client.
 */

import { knownEnum } from "~/lib/contract/known-enum";
import type * as wire from "~/lib/contract/timetable.generated";
import { bffJson } from "./bff-fetch";

/** Arrival/pickup slot source — mirrors SlotSource* in the backend. */
type CarePlanSlotSource = "schedule" | "exception" | "none";

type CarePlanInstanceStatus = "planned" | "active" | "completed" | "cancelled";

/** Attendance status on a plan instance (schedule.instance_students). */
type CarePlanAttendanceStatus = "expected" | "present" | "absent";

/**
 * One arrival or pickup slot for a day. expectedTime is null when
 * source="none", or when source="exception" and the exception expresses
 * absence (no time). reason is populated only for exceptions that carry one —
 * this is how "kommt heute nicht" / früher abgeholt surfaces.
 */
export interface CarePlanSlot {
  expectedTime: string | null; // HH:MM
  source: CarePlanSlotSource;
  reason?: string;
}

/** Per-child attendance payload on a plan instance. */
interface CarePlanAttendance {
  status: CarePlanAttendanceStatus | string;
  substatus: string | null;
  note: string | null;
  checkedInAt: string | null; // RFC3339, Berlin-local
  checkedOutAt: string | null; // RFC3339, Berlin-local
  /** A persisted visit without a booking (child was there, not enrolled). */
  isUnplanned: boolean;
}

/** One planned (or unplanned) instance as it appears in a child's day. */
export interface CarePlanInstance {
  id: string;
  title: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  roomId: string;
  status: CarePlanInstanceStatus | string;
  activeGroupId: string | null;
  attendance: CarePlanAttendance;
}

/** The resolved care plan for one child on one calendar day. */
export interface CarePlanDay {
  studentId: string;
  date: string; // YYYY-MM-DD
  weekday: number; // 1..7 (Mon..Sun)
  arrival: CarePlanSlot;
  instances: CarePlanInstance[];
  pickup: CarePlanSlot;
}

/** A contiguous, inclusive range of care-plan days. */
interface CarePlanWeek {
  studentId: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  days: CarePlanDay[];
}

// --- Mappers ----------------------------------------------------------------

const SLOT_SOURCES: readonly CarePlanSlotSource[] = [
  "schedule",
  "exception",
  "none",
];

function mapSlot(s: wire.SlotResponse): CarePlanSlot {
  const slot: CarePlanSlot = {
    expectedTime: s.expected_time,
    source: knownEnum(SLOT_SOURCES, s.source) ?? "none",
  };
  if (s.reason) slot.reason = s.reason;
  return slot;
}

function mapAttendance(a: wire.AttendanceDayResponse): CarePlanAttendance {
  return {
    status: a.status,
    substatus: a.substatus,
    note: a.note,
    checkedInAt: a.checked_in_at,
    checkedOutAt: a.checked_out_at,
    isUnplanned: a.is_unplanned,
  };
}

function mapInstance(i: wire.InstanceDayResponse): CarePlanInstance {
  return {
    id: i.id,
    title: i.title,
    startTime: i.start_time,
    endTime: i.end_time,
    roomId: i.room_id,
    status: i.status,
    activeGroupId: i.active_group_id,
    attendance: mapAttendance(i.attendance),
  };
}

function mapDay(d: wire.StudentDayResponse): CarePlanDay {
  return {
    studentId: d.student_id,
    date: d.date,
    weekday: d.weekday,
    arrival: mapSlot(d.arrival),
    instances: (d.instances ?? []).map(mapInstance),
    pickup: mapSlot(d.pickup),
  };
}

function mapWeek(w: wire.StudentWeekResponse): CarePlanWeek {
  return {
    studentId: w.student_id,
    from: w.from,
    to: w.to,
    days: (w.days ?? []).map(mapDay),
  };
}

// --- Fetchers ---------------------------------------------------------------

/** Fetch one child's plan for a single day. */
export async function fetchStudentCarePlanDay(
  studentId: string,
  date: string,
): Promise<CarePlanDay> {
  return mapDay(
    await bffJson("tenant", "GET /api/timetable/student/{id}/day", {
      params: { id: studentId },
      query: { date },
    }),
  );
}

/** Fetch one child's plan across an inclusive [from, to] range (max 14 days). */
export async function fetchStudentCarePlanWeek(
  studentId: string,
  from: string,
  to: string,
): Promise<CarePlanWeek> {
  return mapWeek(
    await bffJson("tenant", "GET /api/timetable/student/{id}/week", {
      params: { id: studentId },
      query: { from, to },
    }),
  );
}

/** The recorded corrections of a child's attendance in a block, oldest first. */
export async function fetchAttendanceCorrections(
  instanceId: string,
  studentId: string,
): Promise<wire.attendanceCorrectionResponse[]> {
  const trail = await bffJson(
    "tenant",
    "GET /api/timetable/instances/{instance_id}/students/{student_id}/corrections",
    { params: { instance_id: instanceId, student_id: studentId } },
  );
  return trail.corrections ?? [];
}

/** Changes a recorded attendance; `reason` says why. */
export async function correctAttendance(
  instanceId: string,
  studentId: string,
  correction: wire.CorrectAttendanceRequest,
): Promise<void> {
  await bffJson(
    "tenant",
    "POST /api/timetable/instances/{instance_id}/students/{student_id}/correction",
    {
      params: { instance_id: instanceId, student_id: studentId },
      body: correction,
    },
  );
}
