import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import type * as calendarContract from "~/lib/contract/calendar.generated";
import { knownEnum, requiredEnum } from "~/lib/contract/known-enum";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";
import type * as schoolCalendarContract from "~/lib/contract/school-calendar.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";
import { toISODate } from "~/lib/date-helpers";
import {
  knownMailOutcome,
  type MailOutcome,
  type MailOutcomeCounts,
} from "~/lib/email-delivery-status";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "personal-calendar-api" });

// "closing_day" und "holiday" liefert das Backend nicht als Termin: moto
// schule baut sie aus closing_days/holidays, damit Schließtage und Ferien im
// selben Raster stehen (#4798). "public_holiday" sind die gesetzlichen
// Feiertage aus /api/timetable/holidays in „Mein Kalender“ (#4775).
const BACKEND_SOURCES = ["appointment", "timetable", "shift"] as const;
type CalendarSource =
  | (typeof BACKEND_SOURCES)[number]
  | "closing_day"
  | "holiday"
  | "public_holiday";
const DELIVERY_MODES = ["rsvp_required", "informational"] as const;
export type CalendarDeliveryMode = (typeof DELIVERY_MODES)[number];
const RESPONSE_STATUSES = ["pending", "accepted", "declined", "info"] as const;
export type CalendarResponseStatus = (typeof RESPONSE_STATUSES)[number];

/** An answer of the contract's open enum, undefined when this build does not know it. */
export function knownResponseStatus(
  status: string | undefined,
): CalendarResponseStatus | undefined {
  return knownEnum(RESPONSE_STATUSES, status);
}

/** Art eines Schultermins, den eine Lehrkraft in moto schule anlegt (#4798). */
const SCHOOL_EVENT_TYPES = [
  "ausflug",
  "paedagogischer_tag",
  "unterrichtsende",
  "sonstiges",
] as const;
export type SchoolEventType = (typeof SCHOOL_EVENT_TYPES)[number];

export const SCHOOL_EVENT_TYPE_LABELS: Record<SchoolEventType, string> = {
  ausflug: "Ausflug",
  paedagogischer_tag: "Pädagogischer Tag",
  unterrichtsende: "Unterrichtsende",
  sonstiges: "Sonstiges",
};

/**
 * Art eines Schultermins im Kalender. „elternsprechtag“ trägt ein gebuchtes
 * Zeitfenster am Elternsprechtag (#4801); es entsteht nur durch die Buchung,
 * nie im Formular eines Schultermins.
 */
export type CalendarSchoolEventType = SchoolEventType | "elternsprechtag";
const CALENDAR_SCHOOL_EVENT_TYPES: readonly CalendarSchoolEventType[] = [
  ...SCHOOL_EVENT_TYPES,
  "elternsprechtag",
];

export const CALENDAR_SCHOOL_EVENT_TYPE_LABELS: Record<
  CalendarSchoolEventType,
  string
> = {
  ...SCHOOL_EVENT_TYPE_LABELS,
  elternsprechtag: "Elternsprechtag",
};

/**
 * One entry of a calendar: the generated `Event` with the open enums this
 * build knows narrowed. "closing_day", "holiday" and "public_holiday" are
 * built in the browser (school-calendar.ts, school-holidays-api.ts).
 */
export type CalendarEvent = Omit<
  sharedContract.Event,
  | "source"
  | "delivery_mode"
  | "response_status"
  | "series_response_status"
  | "school_event_type"
  | "cancelled"
  | "recurring"
  | "can_view_overview"
> &
  // Unset on the entries the browser builds itself.
  Partial<
    Pick<sharedContract.Event, "cancelled" | "recurring" | "can_view_overview">
  > & {
    readonly source: CalendarSource;
    readonly delivery_mode?: CalendarDeliveryMode;
    /** Die Antwort für diesen Termin. */
    readonly response_status?: CalendarResponseStatus;
    /**
     * Die Antwort für die ganze Reihe. Sie weicht von `response_status` ab,
     * wenn für diesen Termin eine eigene Antwort gilt (#6987).
     */
    readonly series_response_status?: CalendarResponseStatus;
    /** Gesetzt, wenn eine Lehrkraft den Termin als Schultermin angelegt hat. */
    readonly school_event_type?: CalendarSchoolEventType;
  };

export interface CalendarResponse {
  readonly from: string | null;
  readonly to: string | null;
  readonly events: CalendarEvent[];
}

export type CalendarTargetType =
  | "staff"
  | "guardian_profile"
  | "all_staff"
  | "all_teachers"
  | "all_school_parents"
  | "parents_by_class"
  | "parents_by_group"
  | "parents_by_student";

export interface CalendarTarget {
  readonly type: CalendarTargetType;
  readonly id?: string;
  readonly value?: string;
}

type WithLists<T, K extends keyof T> = Omit<T, K> & {
  readonly [P in K]: NonNullable<T[P]>;
};

/**
 * Staff get every attendee by name. A parent gets the staff and their own
 * entries only; other parents appear in `counts` alone (#6846).
 */
export type CalendarAppointmentOverview = WithLists<
  sharedContract.AppointmentOverview,
  "attendees"
>;

export type CalendarRecipientOptions = WithLists<
  calendarContract.RecipientOptions,
  "staff" | "parents" | "groups" | "classes" | "students"
>;

/**
 * An event of a source this build cannot show is left out; an unknown value
 * of an optional enum stays unset.
 */
function calendarEvents(
  events: readonly sharedContract.Event[] | null,
): CalendarEvent[] {
  const known: CalendarEvent[] = [];
  for (const event of events ?? []) {
    const source = knownEnum(BACKEND_SOURCES, event.source);
    if (source === undefined) {
      logger.warn("calendar_event_unknown_source", { source: event.source });
      continue;
    }
    known.push({
      ...event,
      source,
      delivery_mode: knownEnum(DELIVERY_MODES, event.delivery_mode),
      response_status: knownEnum(RESPONSE_STATUSES, event.response_status),
      series_response_status: knownEnum(
        RESPONSE_STATUSES,
        event.series_response_status,
      ),
      school_event_type: knownEnum(
        CALENDAR_SCHOOL_EVENT_TYPES,
        event.school_event_type,
      ),
    });
  }
  return known;
}

function calendarResponse(
  answer:
    | calendarContract.StaffCalendarResponse
    | parentMeContract.ParentCalendarResponse,
): CalendarResponse {
  return {
    from: answer.from,
    to: answer.to,
    events: calendarEvents(answer.events),
  };
}

/**
 * A request that never got a readable answer (the connection broke, or a 2xx
 * body came back cut off or empty) is `general.unavailable`, and the shared
 * error path shows the catalog text (#2517). Native browser texts ("Load
 * failed") go to the log instead, where a stale or truncated response is
 * diagnosable. Every other failure keeps the backend's code, field errors and
 * request ID; its text stays a diagnostic.
 */
function failed(route: string) {
  return (error: unknown): never => {
    if (!(error instanceof ApiError)) throw error;
    if (error.noResponse) {
      logger.error("calendar_request_failed", {
        path: route,
        stage: "network",
        error: error.message,
      });
    } else if (error.status === 502 && error.problem === undefined) {
      logger.error("calendar_request_failed", { path: route, stage: "body" });
    } else {
      error.message = `Anfrage fehlgeschlagen (HTTP ${error.status})`;
    }
    throw error;
  };
}

function range(from: Date, to: Date) {
  return { from: toISODate(from), to: toISODate(to) };
}

export function getStaffCalendar(from: Date, to: Date) {
  const route = "GET /api/calendar/my";
  return bffJson("tenant", route, { query: range(from, to) }).then(
    calendarResponse,
    failed(route),
  );
}

export function getParentCalendar(from: Date, to: Date) {
  const route = "GET /parent/me/calendar";
  return bffJson("parent", route, { query: range(from, to) }).then(
    calendarResponse,
    failed(route),
  );
}

/**
 * Der Körper einer Zu- oder Absage. Mit `occurrenceDate` gilt sie nur für
 * diesen Termin einer Reihe, sonst für den Termin oder alle Termine (#6987).
 */
function answerBody(
  status: "accepted" | "declined",
  occurrenceDate?: string,
): sharedContract.InvitationAnswer {
  return occurrenceDate
    ? { status, occurrence_date: occurrenceDate }
    : { status };
}

export async function respondStaffCalendar(
  recipientId: string,
  status: "accepted" | "declined",
  occurrenceDate?: string,
): Promise<void> {
  const route = "POST /api/calendar/recipients/{recipientId}/response";
  await bffJson("tenant", route, {
    params: { recipientId },
    body: answerBody(status, occurrenceDate),
  }).catch(failed(route));
}

export async function respondParentCalendar(
  recipientId: string,
  status: "accepted" | "declined",
  occurrenceDate?: string,
): Promise<void> {
  const route = "POST /parent/me/calendar/recipients/{recipientId}/response";
  await bffJson("parent", route, {
    params: { recipientId },
    body: answerBody(status, occurrenceDate),
  }).catch(failed(route));
}

function overview(
  answer: sharedContract.AppointmentOverview,
): CalendarAppointmentOverview {
  return { ...answer, attendees: answer.attendees ?? [] };
}

export function getStaffAppointmentOverview(
  appointmentId: string,
  occurrenceDate?: string,
) {
  const route = "GET /api/calendar/appointments/{appointmentId}/overview";
  return bffJson("tenant", route, {
    params: { appointmentId },
    query: { occurrence_date: occurrenceDate },
  }).then(overview, failed(route));
}

/**
 * What became of an appointment's e-mails to the guardians (#7058), by mail
 * kind. Each guardian counts once per kind, with the newest mail.
 * `not_arrived` names the guardians whose mail did not reach them, never an
 * address. A kind without a mail is absent.
 */
export interface CalendarAppointmentMails {
  readonly awaitingFeedback?: boolean;
  readonly kinds: Readonly<Record<string, MailOutcomeCounts>>;
  readonly not_arrived?: Readonly<Record<string, readonly string[]>>;
}

/** Counts per outcome; an outcome this build does not know is left out. */
function mailCounts(
  counts: Readonly<Record<string, number>> | null,
): MailOutcomeCounts {
  const known: Partial<Record<MailOutcome, number>> = {};
  for (const [key, count] of Object.entries(counts ?? {})) {
    const outcome = knownMailOutcome(key);
    if (outcome) known[outcome] = count;
  }
  return known;
}

function appointmentMails(
  answer: calendarContract.AppointmentMails,
): CalendarAppointmentMails {
  return {
    awaitingFeedback: answer.awaiting_feedback,
    kinds: Object.fromEntries(
      Object.entries(answer.kinds ?? {}).map(([kind, counts]) => [
        kind,
        mailCounts(counts),
      ]),
    ),
    not_arrived: Object.fromEntries(
      Object.entries(answer.not_arrived ?? {}).map(([kind, names]) => [
        kind,
        names ?? [],
      ]),
    ),
  };
}

export function getStaffAppointmentMails(appointmentId: string) {
  const route = "GET /api/calendar/appointments/{appointmentId}/mails";
  return bffJson("tenant", route, { params: { appointmentId } }).then(
    appointmentMails,
    failed(route),
  );
}

export function getParentAppointmentOverview(
  appointmentId: string,
  occurrenceDate?: string,
) {
  const route = "GET /parent/me/calendar/appointments/{appointmentId}/overview";
  return bffJson("parent", route, {
    params: { appointmentId },
    query: { occurrence_date: occurrenceDate },
  }).then(overview, failed(route));
}

/** A subscription feed; only staff get CalDAV access. */
export type CalendarFeedInfo = Pick<
  calendarContract.StaffCalendarAccessResponse,
  "url" | "webcal_url"
> &
  Partial<Pick<calendarContract.StaffCalendarAccessResponse, "caldav">>;

export function getParentCalendarFeed(): Promise<CalendarFeedInfo> {
  const route = "GET /parent/me/calendar/feed";
  return bffJson("parent", route).catch(failed(route));
}

export function rotateParentCalendarFeed(): Promise<CalendarFeedInfo> {
  const route = "POST /parent/me/calendar/feed/rotate";
  return bffJson("parent", route).catch(failed(route));
}

export function getStaffCalendarFeed(): Promise<CalendarFeedInfo> {
  const route = "GET /api/calendar/feed";
  return bffJson("tenant", route).catch(failed(route));
}

export function rotateStaffCalendarFeed(): Promise<CalendarFeedInfo> {
  const route = "POST /api/calendar/feed/rotate";
  return bffJson("tenant", route).catch(failed(route));
}

export async function createStaffAppointment(
  body: calendarContract.createAppointmentRequest,
): Promise<void> {
  const route = "POST /api/calendar/appointments";
  await bffJson("tenant", route, { body }).catch(failed(route));
}

const OVERVIEW_VISIBILITIES = ["organizer", "staff", "all"] as const;
export type CalendarOverviewVisibility = (typeof OVERVIEW_VISIBILITIES)[number];
const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;

/**
 * The staff appointment detail, used to prefill the edit modal with
 * recurrence and visibility that the per-occurrence event omits.
 */
export interface CalendarAppointmentDetail {
  readonly appointment: Pick<
    sharedContract.Appointment,
    "title" | "description" | "location" | "all_day" | "notify_guardians"
  > & {
    // The persisted series anchor, not the clicked occurrence.
    readonly [
      K in "start_date" | "end_date" | "start_time" | "end_time"
    ]-?: NonNullable<sharedContract.Appointment[K]>;
  } & {
    readonly overview_visibility: CalendarOverviewVisibility;
    readonly delivery_mode: CalendarDeliveryMode;
  };
  readonly recurrence?: Pick<
    sharedContract.RecurrenceRule,
    | "interval_count"
    | "weekdays"
    | "month_days"
    | "ends_on"
    | "occurrence_count"
  > & { readonly frequency: (typeof FREQUENCIES)[number] };
  /** The stored appointment as read (ADR 0311); an edit sends it back. */
  readonly version: string;
}

/**
 * "HH:MM" of a stored wall clock: the server sends a TIME column as a
 * timestamp whose clock digits are the wall clock, in whatever offset the
 * driver attached, so the digits are read as they stand.
 */
function wallClock(value: string | undefined, field: string): string {
  const clock = value?.slice(11, 16) ?? "";
  if (!/^\d{2}:\d{2}$/.test(clock)) {
    throw new Error(`contract: appointment detail without ${field}`);
  }
  return clock;
}

/**
 * The edit form saves what it prefilled, so a detail it cannot read whole
 * fails the read instead of saving a guessed value back (ADR 0270 point 6).
 */
function appointmentDetail(
  answer: sharedContract.AppointmentDetail,
): CalendarAppointmentDetail {
  const base = answer.appointment;
  if (!base?.start_date || !base.end_date) {
    throw new Error("contract: appointment detail without its dates");
  }
  const rule = answer.recurrence;
  return {
    appointment: {
      title: base.title,
      description: base.description,
      location: base.location,
      all_day: base.all_day,
      notify_guardians: base.notify_guardians,
      start_date: base.start_date,
      end_date: base.end_date,
      start_time: wallClock(base.start_time, "start_time"),
      end_time: wallClock(base.end_time, "end_time"),
      overview_visibility: requiredEnum(
        OVERVIEW_VISIBILITIES,
        base.overview_visibility,
        "overview_visibility",
      ),
      delivery_mode: requiredEnum(
        DELIVERY_MODES,
        base.delivery_mode,
        "delivery_mode",
      ),
    },
    ...(rule && {
      recurrence: {
        frequency: requiredEnum(FREQUENCIES, rule.frequency, "frequency"),
        interval_count: rule.interval_count,
        weekdays: rule.weekdays,
        month_days: rule.month_days,
        ends_on: rule.ends_on,
        occurrence_count: rule.occurrence_count,
      },
    }),
    version: answer.version,
  };
}

export function getStaffAppointmentDetail(
  appointmentId: string,
): Promise<CalendarAppointmentDetail> {
  const route = "GET /api/calendar/appointments/{appointmentId}";
  return bffJson("tenant", route, { params: { appointmentId } }).then(
    appointmentDetail,
    failed(route),
  );
}

// Editing an appointment cannot change its audience (targets) or delivery
// mode: re-resolving recipients would discard the RSVP responses already
// collected.
export function updateStaffAppointment(
  appointmentId: string,
  body: Omit<calendarContract.updateAppointmentRequest, "expected_version">,
  expectedVersion: string,
): Promise<CalendarAppointmentDetail> {
  const route = "PUT /api/calendar/appointments/{appointmentId}";
  // The edit rests on the version it read; the server refuses it when the
  // appointment changed since (ADR 0311).
  return bffJson("tenant", route, {
    params: { appointmentId },
    body: { ...body, expected_version: expectedVersion },
  }).then(appointmentDetail, failed(route));
}

export async function cancelStaffAppointment(
  appointmentId: string,
): Promise<void> {
  const route = "POST /api/calendar/appointments/{appointmentId}/cancel";
  await bffJson("tenant", route, { params: { appointmentId } }).catch(
    failed(route),
  );
}

export async function deleteStaffAppointment(
  appointmentId: string,
): Promise<void> {
  const route = "DELETE /api/calendar/appointments/{appointmentId}";
  await bffJson("tenant", route, { params: { appointmentId } }).catch(
    failed(route),
  );
}

export async function cancelStaffAppointmentOccurrence(
  appointmentId: string,
  occurrenceDate: string,
): Promise<void> {
  const route =
    "POST /api/calendar/appointments/{appointmentId}/occurrences/{occurrenceDate}/cancel";
  await bffJson("tenant", route, {
    params: { appointmentId, occurrenceDate },
  }).catch(failed(route));
}

export function getCalendarRecipientOptions(
  query: string,
): Promise<CalendarRecipientOptions> {
  const route = "GET /api/calendar/recipient-options";
  const q = query.trim();
  return bffJson("tenant", route, {
    query: { ...(q ? { q } : {}), limit: 30 },
  }).then(
    (options) => ({
      staff: options.staff ?? [],
      parents: options.parents ?? [],
      groups: options.groups ?? [],
      classes: options.classes ?? [],
      students: options.students ?? [],
    }),
    failed(route),
  );
}

// Kalender in moto schule (#4798): dieselben Termine über die school-Session
// und die Proxy-Routen unter /api/school/calendar, dazu Schließtage, Ferien
// und die Klassen der Lehrkraft.

export type SchoolCalendarResponse = CalendarResponse & {
  readonly closing_days: schoolCalendarContract.SchoolDays[];
  readonly holidays: schoolCalendarContract.SchoolDays[];
  readonly classes: string[];
};

/** Welche Eltern einen Schultermin sehen. OGS und Lehrkräfte sehen ihn immer. */
export type SchoolAppointmentParents = "none" | "classes" | "school";

/**
 * Ein Schultermin. `parents` wird nur beim Anlegen gelesen; der
 * Empfängerkreis bleibt danach gleich.
 */
export type SchoolAppointmentRequest =
  schoolCalendarContract.SchoolAppointmentRequest & {
    readonly school_event_type: SchoolEventType;
    readonly parents: SchoolAppointmentParents;
  };

export function mapSchoolCalendar(
  answer: schoolCalendarContract.SchoolCalendarResponse,
): SchoolCalendarResponse {
  return {
    from: answer.from,
    to: answer.to,
    events: calendarEvents(answer.events),
    closing_days: answer.closing_days ?? [],
    holidays: answer.holidays ?? [],
    classes: answer.classes ?? [],
  };
}

export function getSchoolCalendar(
  from: Date,
  to: Date,
): Promise<SchoolCalendarResponse> {
  const route = "GET /school/calendar/my";
  return bffJson("school", route, { query: range(from, to) }).then(
    mapSchoolCalendar,
    failed(route),
  );
}

export async function createSchoolAppointment(
  body: SchoolAppointmentRequest,
): Promise<void> {
  const route = "POST /school/calendar/appointments";
  await bffJson("school", route, { body }).catch(failed(route));
}

export async function updateSchoolAppointment(
  appointmentId: string,
  body: SchoolAppointmentRequest,
  expectedVersion: string,
): Promise<void> {
  const route = "PUT /school/calendar/appointments/{appointmentId}";
  // The change rests on the version of the Schultermin the calendar showed
  // (ADR 0311).
  await bffJson("school", route, {
    params: { appointmentId },
    body: { ...body, expected_version: expectedVersion },
  }).catch(failed(route));
}

export async function deleteSchoolAppointment(
  appointmentId: string,
): Promise<void> {
  const route = "DELETE /school/calendar/appointments/{appointmentId}";
  await bffJson("school", route, { params: { appointmentId } }).catch(
    failed(route),
  );
}

export async function respondSchoolCalendar(
  recipientId: string,
  status: "accepted" | "declined",
  occurrenceDate?: string,
): Promise<void> {
  const route = "POST /school/calendar/recipients/{recipientId}/response";
  await bffJson("school", route, {
    params: { recipientId },
    body: answerBody(status, occurrenceDate),
  }).catch(failed(route));
}

export function getSchoolCalendarFeed(): Promise<CalendarFeedInfo> {
  const route = "GET /school/calendar/feed";
  return bffJson("school", route).catch(failed(route));
}

export function rotateSchoolCalendarFeed(): Promise<CalendarFeedInfo> {
  const route = "POST /school/calendar/feed/rotate";
  return bffJson("school", route).catch(failed(route));
}
