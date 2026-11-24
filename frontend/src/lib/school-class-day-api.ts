// Client-side API für die Klassenansicht im Schul-Portal (#2207). Gleiche
// Report-Typen wie das Tenant-Portal (lib/class-day-api), aber die Next.js
// Routen unter /api/school/* laufen über die school-Session und rufen das
// Backend mit dem school-Token unter /school/class-day auf.

import { ApiError } from "./api-error";
import { bffFile, bffJson } from "./bff-fetch";
import type { StudentStatusKind } from "./student-status-days-api";
import type { ClassDayReport, MorningAttendanceStatus } from "./class-day-api";
import type {
  ClassArrivalExceptionListResponse,
  ClassArrivalExceptionResponse,
} from "./contract/students.generated";
import { requiredDay } from "./contract/required-day";
import type * as schoolClassDayContract from "./contract/school-class-day.generated";

/** Antwort von GET /school/class-day/classes; ohne Klassen eine leere Liste. */
export type ClassDayClasses = Omit<
  schoolClassDayContract.ClassesResponse,
  "classes"
> & { classes: string[] };

export async function fetchClassDayClassesSchool(): Promise<ClassDayClasses> {
  const data = await bffJson("school", "GET /school/class-day/classes");
  return { ...data, classes: data.classes ?? [] };
}

export async function fetchSchoolDaySchool(
  date: string,
): Promise<schoolClassDayContract.SchoolDayReport> {
  return bffJson("school", "GET /school/class-day/school-day", {
    query: { date },
  });
}

export async function fetchClassDaySchool(
  schoolClass: string,
  date: string,
): Promise<ClassDayReport> {
  const report = await bffJson("school", "GET /school/class-day/", {
    query: { class: schoolClass, date },
  });
  return { ...report, rows: report.rows ?? [] };
}

// Tagesausnahme einer Klasse aus moto schule (#2970). Der Klassenname reist
// in der Adresse als Segment; das Backend prüft die Zuweisung.

export async function fetchClassArrivalExceptionsSchool(
  schoolClass: string,
): Promise<ClassArrivalExceptionListResponse> {
  return bffJson("school", "GET /school/class-day/arrival-exceptions", {
    query: { class: schoolClass },
  });
}

export async function upsertClassArrivalExceptionSchool(
  schoolClass: string,
  date: string,
  input: schoolClassDayContract.ArrivalExceptionRequest,
): Promise<ClassArrivalExceptionResponse> {
  return bffJson(
    "school",
    "PUT /school/class-day/arrival-exceptions/{schoolClass}/{date}",
    { params: { schoolClass, date }, body: input },
  );
}

export async function deleteClassArrivalExceptionSchool(
  schoolClass: string,
  date: string,
): Promise<void> {
  await bffJson(
    "school",
    "DELETE /school/class-day/arrival-exceptions/{schoolClass}/{date}",
    { params: { schoolClass, date } },
  );
}

/**
 * Beginn des ersten Betreuungsblocks der Klasse an dem Tag ("HH:MM"), null
 * wenn keiner geplant ist. Vorbelegung für „Unterricht fällt aus“.
 */
export async function fetchClassBlockStartSchool(
  schoolClass: string,
  isoDate: string,
): Promise<string | null> {
  const data = await bffJson(
    "school",
    "GET /school/class-day/arrival-exceptions/block-start",
    { query: { class: schoolClass, date: isoDate } },
  );
  const start = data.start ?? "";
  return start === "" ? null : start;
}

/** Was die Lehrkraft in moto schule meldet (#4799). */
export interface ClassTripReportInput {
  studentIds: string[];
  from: string;
  to: string;
  reason?: string;
  /** "HH:MM", nur bei einem einzelnen Tag. */
  returnTime?: string;
}

/** Ein Tag, an dem ein gewähltes Kind schon einen Status hat (#4799). */
export interface ClassTripConflictDay {
  student_id: string;
  date: string;
  status: StudentStatusKind;
}

/**
 * Liest die blockierenden Tage aus der Ablehnung einer Meldung, wie die OGS
 * sie bei ihrer Klassenfahrt zeigt. Ohne genannte Tage `null`.
 */
export function classTripConflictsFromError(
  err: unknown,
): { conflicts: ClassTripConflictDay[]; total: number } | null {
  if (
    !(err instanceof ApiError) ||
    err.code !== "classday.class_trip_status_conflict"
  ) {
    return null;
  }
  const raw = err.details?.conflicts;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const conflicts = raw.flatMap((entry: unknown): ClassTripConflictDay[] => {
    if (!entry || typeof entry !== "object") return [];
    const { student_id, date, status } = entry as Record<string, unknown>;
    if (
      typeof student_id !== "number" ||
      typeof date !== "string" ||
      (status !== "sick" && status !== "excused" && status !== "class_trip")
    ) {
      return [];
    }
    return [{ student_id: student_id.toString(), date, status }];
  });
  const count = err.details?.conflict_count;
  const total =
    typeof count === "number" && Number.isFinite(count)
      ? count
      : conflicts.length;
  return conflicts.length > 0 ? { conflicts, total } : null;
}

/**
 * Ausflug oder Klassenfahrt einer zugewiesenen Klasse melden (#4799). Ohne
 * Rückkehrzeit gilt jeder Tag als Klassenfahrt; mit Rückkehrzeit (nur ein
 * Tag) kommen die Kinder um diese Uhrzeit in die OGS.
 */
export async function reportClassTripSchool(
  schoolClass: string,
  input: ClassTripReportInput,
): Promise<schoolClassDayContract.ClassTripResult> {
  return bffJson("school", "POST /school/class-day/class-trips/{schoolClass}", {
    params: { schoolClass },
    body: {
      from: input.from,
      to: input.to,
      student_ids: [...input.studentIds],
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.returnTime ? { return_time: input.returnTime } : {}),
    },
  });
}

/**
 * Ein Hinweis an die OGS (#4795): die ganze Klasse ohne studentId, sonst ein
 * Kind der Klasse. Ein Hinweis gilt nur für heute.
 */
export async function saveDayHintSchool(
  schoolClass: string,
  date: string,
  body: string,
  studentId?: string,
): Promise<void> {
  await (studentId
    ? bffJson(
        "school",
        "PUT /school/class-day/day-hints/{schoolClass}/{date}/students/{studentId}",
        { params: { schoolClass, date, studentId }, body: { body } },
      )
    : bffJson(
        "school",
        "PUT /school/class-day/day-hints/{schoolClass}/{date}",
        {
          params: { schoolClass, date },
          body: { body },
        },
      ));
}

export async function deleteDayHintSchool(
  schoolClass: string,
  date: string,
  studentId?: string,
): Promise<void> {
  await (studentId
    ? bffJson(
        "school",
        "DELETE /school/class-day/day-hints/{schoolClass}/{date}/students/{studentId}",
        { params: { schoolClass, date, studentId } },
      )
    : bffJson(
        "school",
        "DELETE /school/class-day/day-hints/{schoolClass}/{date}",
        { params: { schoolClass, date } },
      ));
}

/**
 * Eine Markierung der Anwesenheit am Vormittag (#4790): ein Kind mit
 * OGS-Datensatz über student_id, ein Klassenlisteneintrag über list_entry_id
 * (String, wie in der Tageszeile).
 */
export type MorningAttendanceMark =
  | { student_id: string; status: MorningAttendanceStatus }
  | { list_entry_id: string; status: MorningAttendanceStatus };

/** Speichert die Markierungen einer zugewiesenen Klasse für heute. */
export async function recordMorningAttendanceSchool(
  schoolClass: string,
  date: string,
  marks: readonly MorningAttendanceMark[],
): Promise<void> {
  await bffJson(
    "school",
    "PUT /school/class-day/morning-attendance/{schoolClass}/{date}",
    { params: { schoolClass, date }, body: { marks: [...marks] } },
  );
}

/** Was die Lehrkraft für einen Hausaufgaben-Eintrag schickt (#4796). */
export interface HomeworkInput {
  subject: string | null;
  description: string;
}

/** Trägt Hausaufgaben für eine zugewiesene Klasse und einen Tag ein. */
export async function addHomeworkSchool(
  schoolClass: string,
  date: string,
  input: HomeworkInput,
): Promise<void> {
  await bffJson("school", "POST /school/class-day/homework/{schoolClass}", {
    params: { schoolClass },
    body: { date, ...input },
  });
}

/**
 * Ändert einen Hausaufgaben-Eintrag der Klasse, wie er mit
 * `expectedVersion` gelesen wurde (ADR 0311).
 */
export async function changeHomeworkSchool(
  schoolClass: string,
  homeworkId: string,
  input: HomeworkInput,
  expectedVersion: string,
): Promise<void> {
  await bffJson(
    "school",
    "PUT /school/class-day/homework/{schoolClass}/{homeworkId}",
    {
      params: { schoolClass, homeworkId },
      body: { ...input, expected_version: expectedVersion },
    },
  );
}

/** Löscht einen eigenen Hausaufgaben-Eintrag. */
export async function deleteHomeworkSchool(
  schoolClass: string,
  homeworkId: string,
): Promise<void> {
  await bffJson(
    "school",
    "DELETE /school/class-day/homework/{schoolClass}/{homeworkId}",
    { params: { schoolClass, homeworkId } },
  );
}

/**
 * Die übergebenen Kinder, die in die OGS gehen: „da“ und „nicht da“, und der
 * `handover_version` der Klassenansicht, aus der sie gewählt wurden (ADR
 * 0311): eine inzwischen gespeicherte andere Übergabe weist die Übergabe ab.
 */
export interface ClassHandoverChildren {
  readonly present: readonly string[];
  readonly absent: readonly string[];
  readonly expectedVersion: string;
}

/** Übergibt eine zugewiesene Klasse heute an die OGS (#4794). */
export async function handOverClassSchool(
  schoolClass: string,
  date: string,
  children: ClassHandoverChildren,
): Promise<void> {
  await bffJson(
    "school",
    "PUT /school/class-day/handover/{schoolClass}/{date}",
    {
      params: { schoolClass, date },
      body: {
        present_student_ids: [...children.present],
        absent_student_ids: [...children.absent],
        expected_version: children.expectedVersion,
      },
    },
  );
}

/** Nimmt die heutige Übergabe einer zugewiesenen Klasse zurück (#4794). */
export async function withdrawClassHandoverSchool(
  schoolClass: string,
  date: string,
): Promise<void> {
  await bffJson(
    "school",
    "DELETE /school/class-day/handover/{schoolClass}/{date}",
    { params: { schoolClass, date } },
  );
}

/**
 * Freigegebene Notizen der OGS zu einem Kind (#4797). Nur die Lehrkraft der
 * Klasse bekommt eine Antwort; jeder Abruf wird protokolliert.
 */
export async function fetchSharedNotesSchool(
  schoolClass: string,
  studentId: string,
): Promise<schoolClassDayContract.StudentSharedNotes> {
  return bffJson(
    "school",
    "GET /school/class-day/shared-notes/{schoolClass}/students/{studentId}",
    { params: { schoolClass, studentId } },
  );
}

/** Was die Schulverwaltung nachträgt (#4791). */
export type AbsenceReportStatus = "sick" | "excused";

/**
 * Trägt für ein Kind, das ohne Meldung fehlt, „krank“ oder „entschuldigt“
 * für heute nach (#4791). Die OGS sieht den Status wie jeden anderen.
 */
export async function reportAbsenceSchool(
  schoolClass: string,
  date: string,
  studentId: string,
  status: AbsenceReportStatus,
): Promise<void> {
  await bffJson(
    "school",
    "PUT /school/class-day/absence-reports/{schoolClass}/{date}/students/{studentId}",
    { params: { schoolClass, date, studentId }, body: { status } },
  );
}

/** Nimmt die Meldung zurück, die die Schulverwaltung heute nachgetragen hat. */
export async function withdrawAbsenceReportSchool(
  schoolClass: string,
  date: string,
  studentId: string,
): Promise<void> {
  await bffJson(
    "school",
    "DELETE /school/class-day/absence-reports/{schoolClass}/{date}/students/{studentId}",
    { params: { schoolClass, date, studentId } },
  );
}

// Fehlzeitenliste einer Klasse (#4793): je Kind die Fehltage eines Zeitraums,
// davon entschuldigt und unentschuldigt, für Klassenbuch und Zeugnis.

/** Gezählte Tage eines Kindes oder der ganzen Klasse. */
interface AbsenceListCounts {
  readonly absentDays: number;
  readonly excusedDays: number;
  readonly unexcusedDays: number;
  /** Schultage ohne Anwesenheit und ohne Meldung; kein Fehltag. */
  readonly notRecordedDays: number;
}

export interface AbsenceListChild extends AbsenceListCounts {
  readonly studentId: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface AbsenceList {
  readonly availableFrom: string;
  readonly incomplete: boolean;
  readonly schoolClass: string;
  /** "YYYY-MM-DD" */
  readonly from: string;
  /** "YYYY-MM-DD" */
  readonly to: string;
  /**
   * Name des Halbjahrs aus dem Schulkalender, wenn der Zeitraum daraus
   * vorbelegt ist; sonst leer.
   */
  readonly periodName: string;
  /** Letzter gezählter Tag; leer, wenn kein Tag gezählt werden kann. */
  readonly countedUntil: string;
  readonly schoolDays: number;
  readonly children: readonly AbsenceListChild[];
  readonly totals: AbsenceListCounts;
}

function absenceListCounts(
  raw: schoolClassDayContract.AbsenceListCounts,
): AbsenceListCounts {
  return {
    absentDays: raw.absent_days,
    excusedDays: raw.excused_days,
    unexcusedDays: raw.unexcused_days,
    notRecordedDays: raw.not_recorded_days,
  };
}

function mapAbsenceList(
  raw: schoolClassDayContract.AbsenceListReport,
): AbsenceList {
  return {
    // Go always sets these days: the retention start and the counted period
    // (backend/modules/classday/internal/application/absence_list.go:133).
    availableFrom: requiredDay(
      raw.available_from,
      "absence_list.available_from",
    ),
    incomplete: raw.incomplete,
    schoolClass: raw.school_class,
    from: requiredDay(raw.from, "absence_list.from"),
    to: requiredDay(raw.to, "absence_list.to"),
    periodName: raw.period_name,
    countedUntil: raw.counted_until ?? "",
    schoolDays: raw.school_days,
    children: (raw.children ?? []).map((child) => ({
      studentId: child.student_id,
      firstName: child.first_name,
      lastName: child.last_name,
      ...absenceListCounts(child),
    })),
    totals: absenceListCounts(raw.totals),
  };
}

/** Klasse und Zeitraum einer Fehlzeitenliste. */
export interface AbsenceListQuery {
  readonly schoolClass: string;
  /** Ohne Von und Bis gilt das laufende Schulhalbjahr. */
  readonly period?: { readonly from: string; readonly to: string };
}

function absenceListQuery(query: AbsenceListQuery) {
  return {
    class: query.schoolClass,
    from: query.period?.from,
    to: query.period?.to,
  };
}

export async function fetchAbsenceListSchool(
  query: AbsenceListQuery,
): Promise<AbsenceList> {
  const report = await bffJson("school", "GET /school/class-day/absence-list", {
    query: absenceListQuery(query),
  });
  return mapAbsenceList(report);
}

export type AbsenceListExportFormat = "pdf" | "xlsx";

/** Der Export als PDF oder Excel (#4793); die Antwort trägt die Datei. */
export function fetchAbsenceListExport(
  query: AbsenceListQuery,
  format: AbsenceListExportFormat,
): Promise<Response> {
  return bffFile("school", "GET /school/class-day/absence-list/export", {
    query: { ...absenceListQuery(query), format },
    errorMessage: "absence list export failed",
  });
}
