import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { DEPARTURE_WEEKDAYS } from "./departure-plan";
import { knownEnum } from "./contract/known-enum";
import type {
  ArrivalDataResponse,
  ArrivalNoteRequest,
  ArrivalNoteResponse,
  ArrivalScheduleInput,
  ArrivalScheduleRequestItem,
  ArrivalScheduleResponse,
  BulkUpsertArrivalScheduleRequest,
  BulkUpsertResult,
  ClassArrivalExceptionListResponse,
  ClassArrivalExceptionRequest,
  ClassArrivalExceptionResponse,
  ClassArrivalTimesResponse,
  StudentArrivalExceptionRequest,
  StudentArrivalExceptionResponse,
} from "./contract/students.generated";

/**
 * One care day of a child. The row says the child is in care that weekday;
 * the time on it is optional and comes from the class timetable unless the
 * child deviates (#2414).
 */
export interface ArrivalSchedule {
  id: string;
  studentId: string;
  weekday: number;
  weekdayName: string;
  /** HH:MM, empty when neither the child nor its class carries a time. */
  expectedArrival: string;
  /** "class_schedule" = taken from the class, "staff" = per-child deviation. */
  source?: "class_schedule" | "staff";
  /** The class the time came from, set when source is "class_schedule". */
  sourceClass?: string;
  notes?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArrivalException {
  id: string;
  studentId: string;
  exceptionDate: string;
  expectedArrival?: string | null;
  reason?: string | null;
  // "staff" or "guardian" — a guardian-sourced row was set by a parent in the
  // parents portal.
  source?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArrivalNote {
  id: string;
  studentId: string;
  noteDate: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** The note's read-state token; a change sends it back (ADR 0311). */
  version?: string;
}

export interface ArrivalData {
  schedules: ArrivalSchedule[];
  exceptions: ArrivalException[];
  notes: ArrivalNote[];
}

type ArrivalScheduleSource = NonNullable<ArrivalSchedule["source"]>;
const ARRIVAL_SCHEDULE_SOURCES: readonly ArrivalScheduleSource[] = [
  "class_schedule",
  "staff",
];

function mapArrivalSchedule(data: ArrivalScheduleResponse): ArrivalSchedule {
  return {
    id: data.id,
    studentId: data.student_id,
    weekday: data.weekday,
    weekdayName: data.weekday_name,
    expectedArrival: data.expected_arrival,
    source: knownEnum(ARRIVAL_SCHEDULE_SOURCES, data.source),
    sourceClass: data.source_class,
    notes: data.notes,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

function mapArrivalException(
  data: StudentArrivalExceptionResponse,
): ArrivalException {
  return {
    id: data.id,
    studentId: data.student_id,
    exceptionDate: data.exception_date,
    expectedArrival: data.expected_arrival,
    reason: data.reason,
    source: data.source,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

function mapArrivalNote(data: ArrivalNoteResponse): ArrivalNote {
  return {
    id: data.id,
    studentId: data.student_id,
    noteDate: data.note_date,
    content: data.content,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    ...(data.version ? { version: data.version } : {}),
  };
}

export type CareDaysSource = "weekly_plan" | "bookings";

/** A lesson the school maintains an end time for (#3372). */
export interface SchoolPeriod {
  /** 1-based number of the lesson. */
  period: number;
  /** "HH:MM" */
  endTime: string;
}

const CARE_DAYS_SOURCES: readonly CareDaysSource[] = [
  "weekly_plan",
  "bookings",
];

interface ArrivalSettings {
  /** null: a source this build does not know; the weekly plan is not editable. */
  careDaysSource: CareDaysSource | null;
  /** In lesson order; empty when the school maintains no lesson end times. */
  schoolPeriods: SchoolPeriod[];
  /** "HH:MM", or empty when the school maintains none (#3371). */
  defaultArrivalTime: string;
  /** "HH:MM", or empty when the school maintains none (#3371). */
  defaultPickupTime: string;
}

/**
 * The usual clock times a school offers for one-click adoption in the weekly
 * plan (#3371). Empty strings offer nothing.
 */
export interface CareTimePresets {
  readonly arrival: string;
  readonly pickup: string;
}

export type BulkArrivalFilter =
  | { type: "school_class"; schoolClass: string }
  | { type: "group"; groupId: string }
  | { type: "students"; studentIds: string[] };

/** Mo–Fr with the backend's ISO weekday numbers (1 = Montag). */
export const WEEKDAYS: { value: number; label: string; short: string }[] =
  DEPARTURE_WEEKDAYS.map((day, index) => ({
    value: index + 1,
    label: day.label,
    short: day.label.slice(0, 2),
  }));

export async function fetchArrivalData(
  studentId: string,
  date?: string,
  toDate?: string,
): Promise<ArrivalData> {
  const data = await bffJson(
    "tenant",
    "GET /api/students/{id}/arrival-schedules",
    {
      params: { id: studentId },
      query: { date, to: toDate },
    },
  );
  return mapArrivalData(data);
}

export function mapArrivalData(data: ArrivalDataResponse): ArrivalData {
  return {
    schedules: (data.schedules ?? []).map(mapArrivalSchedule),
    exceptions: (data.exceptions ?? []).map(mapArrivalException),
    notes: (data.notes ?? []).map(mapArrivalNote),
  };
}

export async function fetchBulkArrivalScheduleStatus(
  studentIds: string[],
): Promise<number> {
  const status = await bffJson(
    "tenant",
    "POST /api/students/arrival-schedules/status",
    { body: { student_ids: studentIds } },
  );
  return status.student_ids?.length ?? 0;
}

export async function fetchArrivalSettings(): Promise<ArrivalSettings> {
  const settings = await bffJson(
    "tenant",
    "GET /api/students/arrival-settings",
  );
  return {
    careDaysSource:
      knownEnum(CARE_DAYS_SOURCES, settings.care_days_source) ?? null,
    schoolPeriods: (settings.school_periods ?? []).map((period) => ({
      period: period.period,
      endTime: period.end_time,
    })),
    defaultArrivalTime: settings.default_arrival_time,
    defaultPickupTime: settings.default_pickup_time,
  };
}

/**
 * Saves the weekly arrival plan and, when given, the recurring weekday notes
 * in one request. `expectedVersion` is the weekly plan token of the pickup
 * read the editor started from; the backend refuses the save with
 * `general.changed_since_read` when the plan changed since (ADR 0311).
 */
export async function updateArrivalSchedules(
  studentId: string,
  schedules: ArrivalScheduleRequestItem[],
  plan: {
    expectedVersion: string;
    weekdayNotes?: readonly { weekday: number; content: string }[];
  },
): Promise<ArrivalData> {
  const data = await bffJson(
    "tenant",
    "PUT /api/students/{id}/arrival-schedules",
    {
      params: { id: studentId },
      body: {
        schedules,
        expected_version: plan.expectedVersion,
        ...(plan.weekdayNotes ? { weekday_notes: [...plan.weekdayNotes] } : {}),
      },
    },
  );
  return mapArrivalData(data);
}

const POSITIVE_ID = /^[1-9]\d{0,18}$/;

/**
 * Writes the weekly times of a class, a group or a child list. A class save
 * sends the version of the class times the form was filled from
 * (`expectedVersion`, ADR 0311): the form sends every filled weekday back, so
 * the backend refuses it with `general.changed_since_read` when a colleague
 * changed the class since.
 */
export async function bulkUpsertArrivalSchedules(
  filter: BulkArrivalFilter,
  schedules: ArrivalScheduleInput[],
  expectedVersion?: string,
): Promise<BulkUpsertResult> {
  const body: BulkUpsertArrivalScheduleRequest = { schedules };
  if (filter.type === "school_class") {
    body.school_class = filter.schoolClass;
    body.expected_version = expectedVersion;
  } else if (filter.type === "group") {
    if (!POSITIVE_ID.test(filter.groupId)) {
      throw new ApiError("Ungültige Gruppen-ID", 400, {
        code: "general.input",
      });
    }
    body.group_id = filter.groupId;
  } else {
    const studentIds = [...new Set(filter.studentIds)];
    if (
      studentIds.length === 0 ||
      studentIds.length > 500 ||
      studentIds.some((id) => !POSITIVE_ID.test(id))
    ) {
      throw new ApiError("Ungültige Kinderauswahl", 400, {
        code: "general.input",
      });
    }
    body.student_ids = studentIds;
  }
  return bffJson("tenant", "POST /api/students/arrival-schedules/bulk", {
    body,
  });
}

export async function createArrivalException(
  studentId: string,
  input: StudentArrivalExceptionRequest,
): Promise<ArrivalException> {
  const data = await bffJson(
    "tenant",
    "POST /api/students/{id}/arrival-exceptions",
    {
      params: { id: studentId },
      body: input,
    },
  );
  return mapArrivalException(data);
}

export async function updateArrivalException(
  studentId: string,
  exceptionId: string,
  input: StudentArrivalExceptionRequest,
): Promise<ArrivalException> {
  const data = await bffJson(
    "tenant",
    "PUT /api/students/{id}/arrival-exceptions/{exceptionId}",
    { params: { id: studentId, exceptionId }, body: input },
  );
  return mapArrivalException(data);
}

export async function deleteArrivalException(
  studentId: string,
  exceptionId: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "DELETE /api/students/{id}/arrival-exceptions/{exceptionId}",
    {
      params: { id: studentId, exceptionId },
    },
  );
}

export async function createArrivalNote(
  studentId: string,
  input: ArrivalNoteRequest,
): Promise<ArrivalNote> {
  const data = await bffJson(
    "tenant",
    "POST /api/students/{id}/arrival-notes",
    {
      params: { id: studentId },
      body: input,
    },
  );
  return mapArrivalNote(data);
}

/** Changes a note as read at `expectedVersion` (ADR 0311). */
export async function updateArrivalNote(
  studentId: string,
  noteId: string,
  input: ArrivalNoteRequest,
  expectedVersion: string,
): Promise<ArrivalNote> {
  const data = await bffJson(
    "tenant",
    "PUT /api/students/{id}/arrival-notes/{noteId}",
    {
      params: { id: studentId, noteId },
      body: { ...input, expected_version: expectedVersion },
    },
  );
  return mapArrivalNote(data);
}

export async function deleteArrivalNote(
  studentId: string,
  noteId: string,
): Promise<void> {
  await bffJson("tenant", "DELETE /api/students/{id}/arrival-notes/{noteId}", {
    params: { id: studentId, noteId },
  });
}

/** The Unterrichtsschluss a school class carries (#2414). */
export async function fetchClassArrivalTimes(
  schoolClass: string,
): Promise<ClassArrivalTimesResponse> {
  return bffJson(
    "tenant",
    "GET /api/students/class-arrival-times/{schoolClass}",
    {
      params: { schoolClass },
    },
  );
}

/**
 * Lists the class-wide exceptions from today on (backend default: 60 days):
 * dates on which a whole class arrives at a different time than its
 * Unterrichtsschluss says (#2962), for example "Unterricht fällt aus".
 */
export async function fetchClassArrivalExceptions(
  schoolClass: string,
): Promise<ClassArrivalExceptionListResponse> {
  return bffJson(
    "tenant",
    "GET /api/students/class-arrival-exceptions/{schoolClass}",
    {
      params: { schoolClass },
    },
  );
}

export async function upsertClassArrivalException(
  schoolClass: string,
  date: string,
  input: ClassArrivalExceptionRequest,
): Promise<ClassArrivalExceptionResponse> {
  return bffJson(
    "tenant",
    "PUT /api/students/class-arrival-exceptions/{schoolClass}/{date}",
    { params: { schoolClass, date }, body: input },
  );
}

export async function deleteClassArrivalException(
  schoolClass: string,
  date: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "DELETE /api/students/class-arrival-exceptions/{schoolClass}/{date}",
    { params: { schoolClass, date } },
  );
}
