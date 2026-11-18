/**
 * Einsatzplanung des Trägers über alle Standorte (#4708, ADR 0242).
 *
 * Die Personalverwaltung plant eine Person mit Personalakte an jedem ihrer
 * Einsatzorte. Jede Schicht ist eine Schicht im Dienstplan der Schule und
 * erscheint dort sofort. moto prüft jede Schicht über alle Einsatzorte:
 * Überschneidungen sind gesperrt, ein Verstoß gegen eine Arbeitszeitregel
 * braucht eine Bestätigung (`~/lib/working-time`). Die Woche ist
 * Personendaten: jede Anfrage steht im Zugriffsprotokoll der Schulen.
 */
import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
} from "./traeger-list-export";
import { traegerRequest } from "~/lib/traeger-api";
import {
  mapWorkingTimeWarnings,
  workingTimeBody,
  type WorkingTimeConfirmation,
  type WorkingTimeWarning,
} from "~/lib/working-time";

const BASE = "/api/traeger/staff-planning";

/** Die Werte, gegen die moto die Woche prüft, alle in Minuten. */
export interface TraegerPlanningRules {
  /** `false`: der Träger plant außerhalb von moto, neue Schichten sind gesperrt. */
  readonly enabled: boolean;
  readonly maxDailyMinutes: number;
  readonly minRestMinutes: number;
  readonly checkBreaks: boolean;
}

interface TraegerPlanningSite {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly staffId: string;
}

export interface TraegerPlanningShift {
  readonly id: string;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly staffId: string;
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** "HH:MM" */
  readonly startTime: string;
  /** "HH:MM" */
  readonly endTime: string;
  readonly breakMinutes: number;
  readonly notes: string;
  readonly cancelled: boolean;
  readonly shiftTypeName: string | null;
  readonly shiftTypeColor: string | null;
  /** Die Personalverwaltung hat die Schicht geplant, nicht die Schule. */
  readonly plannedByTraeger: boolean;
  /** Die Schicht gehört zu einer Serie der Schule. */
  readonly fromSeries: boolean;
}

export interface TraegerPlanningPerson {
  readonly recordId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly sites: readonly TraegerPlanningSite[];
  readonly shifts: readonly TraegerPlanningShift[];
  readonly plannedMinutes: number;
  /** Soll der Woche aus den Arbeitsverträgen; `null` ohne Vertrag. */
  readonly sollMinutes: number | null;
  readonly warnings: readonly WorkingTimeWarning[];
}

export interface TraegerPlanningSchool {
  readonly id: string;
  readonly name: string;
}

export interface TraegerPlanningWeek {
  /** Montag der Woche, "YYYY-MM-DD". */
  readonly weekStart: string;
  readonly rules: TraegerPlanningRules;
  readonly schools: readonly TraegerPlanningSchool[];
  readonly people: readonly TraegerPlanningPerson[];
  /** Schulen, deren Woche moto gerade nicht lesen konnte. */
  readonly unreached: readonly TraegerPlanningSchool[];
}

export interface TraegerPlanShiftInput {
  readonly schoolId: string;
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** "HH:MM" */
  readonly startTime: string;
  /** "HH:MM" */
  readonly endTime: string;
  readonly breakMinutes: number;
  readonly notes: string;
  readonly workingTime?: WorkingTimeConfirmation;
}

/** Künftige Schichten einer Schule, vor dem Ausschalten der Einsatzplanung. */
export interface TraegerFutureShifts {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly shifts: number;
}

interface BackendShift {
  id: number | string;
  school_id: number | string;
  school_name: string;
  staff_id: number | string;
  date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  notes?: string;
  cancelled: boolean;
  shift_type_name?: string;
  shift_type_color?: string;
  planned_by_traeger: boolean;
  from_series: boolean;
}

interface BackendPerson {
  staff_record_id: number | string;
  first_name: string;
  last_name: string;
  sites:
    | {
        school_id: number | string;
        school_name: string;
        staff_id: number | string;
      }[]
    | null;
  shifts: BackendShift[] | null;
  planned_minutes: number;
  soll_minutes: number | null;
  warnings: unknown;
}

interface BackendSchool {
  id: number | string;
  name: string;
}

interface BackendWeek {
  week_start: string;
  rules: {
    enabled: boolean;
    max_daily_minutes: number;
    min_rest_minutes: number;
    check_breaks: boolean;
  };
  schools: BackendSchool[] | null;
  people: BackendPerson[] | null;
  unreached: BackendSchool[] | null;
}

const mapSchool = (school: BackendSchool): TraegerPlanningSchool => ({
  id: String(school.id),
  name: school.name,
});

function mapPlanningShift(shift: BackendShift): TraegerPlanningShift {
  return {
    id: String(shift.id),
    schoolId: String(shift.school_id),
    schoolName: shift.school_name,
    staffId: String(shift.staff_id),
    date: shift.date.slice(0, 10),
    startTime: shift.start_time.slice(0, 5),
    endTime: shift.end_time.slice(0, 5),
    breakMinutes: shift.break_minutes,
    notes: shift.notes ?? "",
    cancelled: shift.cancelled,
    shiftTypeName: shift.shift_type_name ?? null,
    shiftTypeColor: shift.shift_type_color ?? null,
    plannedByTraeger: shift.planned_by_traeger,
    fromSeries: shift.from_series,
  };
}

function mapPlanningWeek(week: BackendWeek): TraegerPlanningWeek {
  return {
    weekStart: week.week_start.slice(0, 10),
    rules: {
      enabled: week.rules.enabled,
      maxDailyMinutes: week.rules.max_daily_minutes,
      minRestMinutes: week.rules.min_rest_minutes,
      checkBreaks: week.rules.check_breaks,
    },
    schools: (week.schools ?? []).map(mapSchool),
    unreached: (week.unreached ?? []).map(mapSchool),
    people: (week.people ?? []).map((person) => ({
      recordId: String(person.staff_record_id),
      firstName: person.first_name,
      lastName: person.last_name,
      sites: (person.sites ?? []).map((site) => ({
        schoolId: String(site.school_id),
        schoolName: site.school_name,
        staffId: String(site.staff_id),
      })),
      shifts: (person.shifts ?? []).map(mapPlanningShift),
      plannedMinutes: person.planned_minutes,
      sollMinutes: person.soll_minutes,
      warnings: mapWorkingTimeWarnings(person.warnings),
    })),
  };
}

function shiftBody(input: TraegerPlanShiftInput) {
  return {
    school_id: input.schoolId,
    date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    break_minutes: input.breakMinutes,
    notes: input.notes,
    ...workingTimeBody(input.workingTime),
  };
}

const recordPath = (recordId: string) =>
  `${BASE}/records/${encodeURIComponent(recordId)}`;

/** Die Woche, in der `weekStart` liegt, Montag bis Sonntag. */
export async function fetchTraegerPlanningWeek(
  weekStart: string,
): Promise<TraegerPlanningWeek> {
  const week = await traegerRequest<BackendWeek>(
    `${BASE}?week=${encodeURIComponent(weekStart)}`,
  );
  return mapPlanningWeek(week);
}

/**
 * Die Woche ab `weekStart` als Datei, eine Zeile je Person und eine Spalte je
 * Tag; der Download steht im Zugriffsprotokoll.
 */
export function downloadTraegerPlanningWeek(
  weekStart: string,
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(`${BASE}/export`, format, { week: weekStart });
}

export async function planTraegerShift(
  recordId: string,
  input: TraegerPlanShiftInput,
): Promise<TraegerPlanningShift> {
  const shift = await traegerRequest<BackendShift>(
    `${recordPath(recordId)}/shifts`,
    { method: "POST", body: shiftBody(input) },
  );
  return mapPlanningShift(shift);
}

export async function changeTraegerShift(
  recordId: string,
  shiftId: string,
  input: TraegerPlanShiftInput,
): Promise<TraegerPlanningShift> {
  const shift = await traegerRequest<BackendShift>(
    `${recordPath(recordId)}/shifts/${encodeURIComponent(shiftId)}`,
    { method: "PUT", body: shiftBody(input) },
  );
  return mapPlanningShift(shift);
}

export async function removeTraegerShift(
  recordId: string,
  schoolId: string,
  shiftId: string,
): Promise<void> {
  await traegerRequest<null>(
    `${recordPath(recordId)}/schools/${encodeURIComponent(schoolId)}/shifts/${encodeURIComponent(shiftId)}`,
    { method: "DELETE" },
  );
}

/** Schulen mit Schichten nach heute; vor dem Ausschalten der Einsatzplanung. */
export async function fetchTraegerFutureShifts(): Promise<
  TraegerFutureShifts[]
> {
  const schools = await traegerRequest<
    { school_id: number | string; school_name: string; shifts: number }[] | null
  >(`${BASE}/future-shifts`);
  return (schools ?? []).map((school) => ({
    schoolId: String(school.school_id),
    schoolName: school.school_name,
    shifts: school.shifts,
  }));
}
