/**
 * Schließtage des Trägers und Feiertage seiner Schulen (#4702).
 *
 * Das Träger-Büro plant Schließtage wie Brückentage oder einen
 * Betriebsausflug für einige oder alle Schulen. Sie wirken wie die
 * Schließtage, die eine Schule selbst einträgt. Die gesetzlichen Feiertage
 * kommen aus dem Bundesland jeder Schule; das Bundesland legt das moto-Team
 * fest, der Träger sieht es nur.
 */
import { requiredDay } from "./contract/required-day";
import type {
  Calendar as WireCalendar,
  ClosingDay as WireClosingDay,
  TraegerClosingDayDeleted,
  TraegerClosingDayRequest,
} from "./contract/traeger-closing-days.generated";
import type {
  HolidayClosedDay as WireClosedDay,
  HolidayClosureImpact as WireImpact,
  HolidayClosurePreviewRequest,
  HolidayClosureWeek as WireWeek,
  NotifiedPending,
  NotifyAllRequest,
  Pending as WirePending,
  TraegerNotice as WireTraegerNotice,
} from "./contract/traeger-holiday-closures.generated";
import {
  type HolidayClosureNotice,
  type HolidayClosureNoticeWire,
  mapHolidayClosureNotice,
} from "./holiday-closure-notices";
import { traegerRequest } from "./traeger-api";

export interface TraegerClosingDay {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly schoolIds: readonly string[];
}

export interface TraegerClosingDayInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly schoolIds: readonly string[];
  /**
   * Bestätigt die Vorschau der betroffenen Ferienbuchungen (#6434); leer,
   * wenn die Vorschau keine zeigte.
   */
  readonly holidayBookingsToken?: string;
}

/** Ein gespeicherter Schließtag mit der Zahl der informierten Familien. */
export interface SavedTraegerClosingDay extends TraegerClosingDay {
  readonly notifiedFamilies: number;
}

/** Ein geschlossener oder wieder geöffneter Tag in einer gebuchten Ferienwoche. */
interface HolidayClosedDay {
  readonly date: string;
  readonly reason: string;
}

/** Eine betroffene Ferienwoche mit der Zahl der Kinder und Familien. */
export interface HolidayClosureWeek {
  readonly weekId: string;
  readonly periodName: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly hostSchoolId: string;
  readonly closedDays: readonly HolidayClosedDay[];
  /** Tage, die nach einer Änderung oder Löschung doch geöffnet sind (#6457). */
  readonly reopenedDays: readonly HolidayClosedDay[];
  readonly children: number;
  readonly waitlisted: number;
  readonly families: number;
}

/**
 * Was ein Schließtag für die Ferienbuchungen heißt (#6434): die betroffenen
 * Wochen, Kinder und Familien und das Zeichen, mit dem das Speichern die
 * Vorschau bestätigt. Keine Namen von Kindern.
 */
export interface HolidayClosureImpact {
  readonly weeks: readonly HolidayClosureWeek[];
  readonly children: number;
  readonly families: number;
  readonly token: string;
  readonly keepsContribution: boolean;
}

/**
 * Ein Elternhinweis zu einem Schul-Schließtag in der Liste des Träger-Büros
 * (ADR 0196): mit den betroffenen Wochen und Kindern, solange er auf einen
 * Klick wartet. Den Namen der Schule liefert der Kalender des Trägers.
 */
export interface TraegerHolidayClosureNotice extends HolidayClosureNotice {
  readonly weeks: readonly HolidayClosureWeek[];
  readonly children: number;
}

/** Die Liste „Eltern noch nicht informiert“ mit allen Hinweisen. */
export interface PendingHolidayClosures extends HolidayClosureImpact {
  readonly retryableMails?: number;
  readonly unknownMails?: number;
  readonly notices: readonly TraegerHolidayClosureNotice[];
}

export interface TraegerCalendarSchool {
  readonly id: string;
  readonly name: string;
  readonly federalStateCode: string;
  readonly federalStateName: string;
}

interface TraegerHoliday {
  readonly date: string;
  readonly name: string;
}

interface TraegerRegionHolidays {
  readonly code: string;
  readonly name: string;
  readonly holidays: readonly TraegerHoliday[];
}

export interface TraegerCalendar {
  readonly closingDays: readonly TraegerClosingDay[];
  readonly schools: readonly TraegerCalendarSchool[];
  readonly regions: readonly TraegerRegionHolidays[];
}

const basePath = "/api/traeger/closing-days";

function mapTraegerClosingDay(day: WireClosingDay): TraegerClosingDay {
  return {
    id: day.id,
    startDate: requiredDay(day.start_date, "closing_day.start_date"),
    endDate: requiredDay(day.end_date, "closing_day.end_date"),
    reason: day.reason,
    schoolIds: day.school_ids ?? [],
  };
}

function mapTraegerCalendar(data: WireCalendar): TraegerCalendar {
  return {
    closingDays: (data.closing_days ?? []).map(mapTraegerClosingDay),
    schools: (data.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
      federalStateCode: school.federal_state.code,
      federalStateName: school.federal_state.name,
    })),
    regions: (data.holidays ?? []).map((region) => ({
      code: region.region.code,
      name: region.region.name,
      holidays: (region.holidays ?? []).map((holiday) => ({
        date: requiredDay(holiday.date, "holiday.date"),
        name: holiday.name,
      })),
    })),
  };
}

function backendInput(input: TraegerClosingDayInput): TraegerClosingDayRequest {
  return {
    start_date: input.startDate,
    end_date: input.endDate,
    reason: input.reason.trim(),
    school_ids: input.schoolIds.map(Number),
    holiday_bookings_token: input.holidayBookingsToken ?? "",
  };
}

/**
 * Der gespeicherte Stand eines Schließtags, den die Vorschau beim Ändern oder
 * Löschen mitschickt: Seine Tage können wieder öffnen (#6457).
 */
export interface TraegerClosingDayChange {
  readonly closingDay: TraegerClosingDay;
  /** Vorschau zum Löschen statt zum Speichern. */
  readonly delete?: boolean;
}

function backendChange(
  change: TraegerClosingDayChange | undefined,
): Pick<
  HolidayClosurePreviewRequest,
  "closing_day_id" | "previous" | "delete"
> {
  if (!change) return {};
  return {
    closing_day_id: Number(change.closingDay.id),
    previous: {
      school_ids: change.closingDay.schoolIds.map(Number),
      start_date: change.closingDay.startDate,
      end_date: change.closingDay.endDate,
    },
    ...(change.delete ? { delete: true } : {}),
  };
}

function mapSavedClosingDay(day: WireClosingDay): SavedTraegerClosingDay {
  return {
    ...mapTraegerClosingDay(day),
    notifiedFamilies: day.notified_families,
  };
}

function closedDays(days: readonly WireClosedDay[] | null): HolidayClosedDay[] {
  return (days ?? []).map((day) => ({
    date: requiredDay(day.date, "holiday_closed_day.date"),
    reason: day.reason,
  }));
}

function mapHolidayClosureWeek(week: WireWeek): HolidayClosureWeek {
  return {
    weekId: week.week_id,
    periodName: week.period_name,
    startsOn: requiredDay(week.starts_on, "holiday_closure_week.starts_on"),
    endsOn: requiredDay(week.ends_on, "holiday_closure_week.ends_on"),
    hostSchoolId: week.host_school_id,
    closedDays: closedDays(week.closed_days),
    reopenedDays: closedDays(week.reopened_days),
    children: week.children,
    waitlisted: week.waitlisted,
    families: week.families,
  };
}

function mapTraegerNotice(
  notice: WireTraegerNotice,
): TraegerHolidayClosureNotice {
  return {
    ...mapHolidayClosureNotice(notice),
    weeks: (notice.weeks ?? []).map(mapHolidayClosureWeek),
    children: notice.children,
  };
}

function mapHolidayClosureImpact(data: WireImpact): HolidayClosureImpact {
  return {
    weeks: (data.weeks ?? []).map(mapHolidayClosureWeek),
    children: data.children,
    families: data.families,
    token: data.token,
    keepsContribution: data.keeps_contribution,
  };
}

const closuresPath = "/api/traeger/holiday-closures";

/**
 * Welche Ferienbuchungen der geplante Schließtag betrifft (#6434). Beim
 * Ändern oder Löschen nennt `change` den gespeicherten Stand; dann zeigt die
 * Vorschau auch die Tage, die wieder öffnen (#6457).
 */
export async function previewTraegerClosingDayHolidayBookings(
  input: TraegerClosingDayInput,
  change?: TraegerClosingDayChange,
): Promise<HolidayClosureImpact> {
  return mapHolidayClosureImpact(
    await traegerRequest<WireImpact>(`${closuresPath}/preview`, {
      method: "POST",
      body: {
        ...backendInput(input),
        ...backendChange(change),
      } satisfies HolidayClosurePreviewRequest,
    }),
  );
}

/**
 * Elternhinweise zu Schließtagen in gebuchten Ferienwochen (ADR 0196): die
 * Vorschläge, die auf einen Klick warten, mit ihren Wochen und Familien, und
 * jeder beauftragte Hinweis mit seinem Versandstand.
 */
export async function fetchPendingHolidayClosures(): Promise<PendingHolidayClosures> {
  const data = await traegerRequest<WirePending>(`${closuresPath}/pending`);
  return {
    ...mapHolidayClosureImpact(data),
    notices: (data.notices ?? []).map(mapTraegerNotice),
    retryableMails: data.retryable_mails,
    unknownMails: data.unknown_mails,
  };
}

/**
 * Beauftragt einen Hinweis mit dem Stand, den das Büro gesehen hat, oder holt
 * einen gescheiterten Versand nach. Derselbe Auftrag wie beim Klick der Schule.
 */
export async function notifyTraegerHolidayClosureNotice(
  id: string,
  revision: number,
  token: string,
): Promise<HolidayClosureNotice> {
  return mapHolidayClosureNotice(
    await traegerRequest<HolidayClosureNoticeWire>(
      `${closuresPath}/pending/${encodeURIComponent(id)}/notify`,
      { method: "POST", body: { revision, token } },
    ),
  );
}

/** Beauftragt alle Vorschläge der Liste; gibt die Zahl der Familien. */
export async function notifyPendingHolidayClosures(
  token: string,
): Promise<number> {
  const result = await traegerRequest<NotifiedPending>(
    `${closuresPath}/pending/notify`,
    { method: "POST", body: { token } satisfies NotifyAllRequest },
  );
  return result.families;
}

/** Der Kalender des Trägers im Fenster [from, to]. */
export async function fetchTraegerCalendar(
  from: string,
  to: string,
): Promise<TraegerCalendar> {
  const query = new URLSearchParams({ from, to });
  return mapTraegerCalendar(
    await traegerRequest<WireCalendar>(`${basePath}?${query.toString()}`),
  );
}

export async function createTraegerClosingDay(
  input: TraegerClosingDayInput,
): Promise<SavedTraegerClosingDay> {
  return mapSavedClosingDay(
    await traegerRequest<WireClosingDay>(basePath, {
      method: "POST",
      body: backendInput(input),
    }),
  );
}

export async function updateTraegerClosingDay(
  id: string,
  input: TraegerClosingDayInput,
): Promise<SavedTraegerClosingDay> {
  return mapSavedClosingDay(
    await traegerRequest<WireClosingDay>(
      `${basePath}/${encodeURIComponent(id)}`,
      { method: "PUT", body: backendInput(input) },
    ),
  );
}

/**
 * Löscht den Schließtag. Betrifft er Ferienbuchungen, bestätigt
 * `holidayBookingsToken` die Vorschau; die Eltern erfahren dann, dass ihre
 * Tage wieder geöffnet sind (#6457). Gibt die Zahl der Familien.
 */
export async function deleteTraegerClosingDay(
  id: string,
  holidayBookingsToken = "",
): Promise<number> {
  const query = holidayBookingsToken
    ? `?${new URLSearchParams({ holiday_bookings_token: holidayBookingsToken }).toString()}`
    : "";
  const result = await traegerRequest<TraegerClosingDayDeleted>(
    `${basePath}/${encodeURIComponent(id)}${query}`,
    { method: "DELETE" },
  );
  return result.notified_families;
}
