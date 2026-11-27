/**
 * An extra care day of a Träger (#4817): one weekday outside the holidays,
 * such as a bridge day, offered at one or several schools. The backend
 * stores it as a holiday period of the kind "extra_day" with one single-day
 * week per school; this file is the form's view of it and the checks the
 * form runs before it sends.
 */

import { isValidISODate, parseISODate } from "~/lib/date-helpers";
import type { HolidayPeriod, HolidayPeriodInput } from "~/lib/traeger-api";
import type { TraegerCalendar } from "~/lib/traeger-closing-days";
import { formatEuro } from "./contribution-format";
import { formatDayWithWeekday } from "./closing-day-format";
import { centsToEuroInput, euroInputToCents } from "./holiday-period-model";

/** Covered by the monthly contribution, or booked at a price per day. */
export type ExtraDayFeeMode = "included" | "day_price";

export interface ExtraDayDraft {
  readonly name: string;
  /** The day itself, "YYYY-MM-DD". */
  readonly date: string;
  readonly schoolIds: readonly string[];
  /** Care time, wall-clock "HH:MM". */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly registrationOpensOn: string;
  readonly registrationClosesOn: string;
  readonly feeMode: ExtraDayFeeMode;
  /** Price of the day as typed, in euro; kept while the day is included. */
  readonly price: string;
  readonly binding: boolean;
  readonly notes: string;
}

/** The name of the one care time parents book on an extra day. */
const CARE_TIME_NAME = "Betreuung";
const MAX_PRICE_CENTS = 1_000_000;
const WALL_CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A new extra day: registration opens today, the day is included. */
export function emptyExtraDay(today: string): ExtraDayDraft {
  return {
    name: "",
    date: "",
    schoolIds: [],
    startsAt: "",
    endsAt: "",
    registrationOpensOn: today,
    registrationClosesOn: "",
    feeMode: "included",
    price: "",
    binding: true,
    notes: "",
  };
}

/** The care time of a school's day that parents can still book. */
function offeredCareTime(period: HolidayPeriod) {
  for (const week of period.weeks) {
    const model = week.timeModels.find((entry) => !entry.archived);
    if (model) return model;
  }
  return undefined;
}

export function draftFromExtraDay(period: HolidayPeriod): ExtraDayDraft {
  const careTime = offeredCareTime(period);
  return {
    name: period.name,
    date: period.weeks[0]?.startsOn ?? "",
    schoolIds: period.weeks.map((week) => week.hostSchoolId),
    startsAt: careTime?.startsAt ?? "",
    endsAt: careTime?.endsAt ?? "",
    registrationOpensOn: period.registrationOpensOn,
    registrationClosesOn: period.registrationClosesOn,
    feeMode: period.includedInFee ? "included" : "day_price",
    price:
      period.includedInFee || !careTime
        ? ""
        : centsToEuroInput(careTime.priceCents),
    binding: period.binding,
    notes: period.notes,
  };
}

/**
 * The request body; call only after `validateExtraDay` found nothing. A
 * school the stored day already has keeps its week and care time, so its
 * bookings stay.
 */
export function inputFromExtraDay(
  draft: ExtraDayDraft,
  stored?: HolidayPeriod,
): HolidayPeriodInput {
  const included = draft.feeMode === "included";
  const priceCents = included ? 0 : (euroInputToCents(draft.price) ?? 0);
  return {
    kind: "extra_day",
    includedInFee: included,
    name: draft.name.trim(),
    registrationOpensOn: draft.registrationOpensOn,
    registrationClosesOn: draft.registrationClosesOn,
    binding: draft.binding,
    notes: draft.notes.trim(),
    holidayWishRule: false,
    maxDaysPerChild: null,
    allocationMode: "arrival",
    weeks: draft.schoolIds.map((schoolId) => {
      const week = stored?.weeks.find(
        (entry) => entry.hostSchoolId === schoolId,
      );
      const archived = (week?.timeModels ?? []).filter(
        (model) => model.archived,
      );
      const current = week?.timeModels.find((model) => !model.archived);
      return {
        id: week?.id,
        startsOn: draft.date,
        endsOn: draft.date,
        hostSchoolId: schoolId,
        bookingUnit: "week" as const,
        timeModels: [
          {
            id: current?.id,
            name: current?.name ?? CARE_TIME_NAME,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            priceCents,
          },
          // An archived care time stays as it is; an included day prices none.
          ...archived.map((model) => ({
            ...model,
            priceCents: included ? 0 : model.priceCents,
          })),
        ],
      };
    }),
  };
}

function isWeekday(date: string): boolean {
  const day = parseISODate(date).getDay();
  return day !== 0 && day !== 6;
}

function checkDay(draft: ExtraDayDraft, errors: Record<string, string>) {
  if (!isValidISODate(draft.date)) {
    errors.date = "Bitte wähle den Tag.";
  } else if (!isWeekday(draft.date)) {
    errors.date = "Ein Zusatztag liegt auf einem Tag von Montag bis Freitag.";
  }
  if (draft.schoolIds.length === 0) {
    errors.schools = "Bitte wähle mindestens eine Schule.";
  }
}

function checkCareTime(draft: ExtraDayDraft, errors: Record<string, string>) {
  const startsValid = WALL_CLOCK.test(draft.startsAt);
  if (!startsValid) {
    errors.starts_at = draft.startsAt
      ? "Bitte gib die Zeit im Format 08:00 ein."
      : "Bitte trage den Beginn ein.";
  }
  if (!WALL_CLOCK.test(draft.endsAt)) {
    errors.ends_at = draft.endsAt
      ? "Bitte gib die Zeit im Format 16:00 ein."
      : "Bitte trage das Ende ein.";
  } else if (startsValid && draft.endsAt <= draft.startsAt) {
    errors.ends_at = "Das Ende liegt nicht nach dem Beginn.";
  }
}

function checkRegistration(
  draft: ExtraDayDraft,
  errors: Record<string, string>,
) {
  if (!isValidISODate(draft.registrationOpensOn)) {
    errors.registration_opens_on = "Bitte wähle den Anmeldebeginn.";
  }
  if (!isValidISODate(draft.registrationClosesOn)) {
    errors.registration_closes_on = "Bitte wähle den Anmeldeschluss.";
  } else if (
    isValidISODate(draft.registrationOpensOn) &&
    draft.registrationClosesOn < draft.registrationOpensOn
  ) {
    errors.registration_closes_on =
      "Der Anmeldeschluss liegt vor dem Anmeldebeginn.";
  } else if (
    isValidISODate(draft.date) &&
    draft.registrationClosesOn > draft.date
  ) {
    errors.registration_closes_on =
      "Der Anmeldeschluss liegt nach dem Zusatztag.";
  }
}

function checkFee(draft: ExtraDayDraft, errors: Record<string, string>) {
  if (draft.feeMode === "included") return;
  const cents = euroInputToCents(draft.price);
  if (cents === null || cents > MAX_PRICE_CENTS) {
    errors.price = "Bitte gib einen Preis in Euro ein, zum Beispiel 18,00.";
  } else if (cents === 0) {
    errors.price =
      "Bitte gib einen Preis ein. Kostet der Tag nichts extra, wähle „Im Monatsbeitrag enthalten“.";
  }
}

/**
 * The checks of the form, keyed by the name of the control. Empty means the
 * draft can be sent.
 */
export function validateExtraDay(draft: ExtraDayDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Bitte gib einen Namen ein.";
  checkDay(draft, errors);
  checkCareTime(draft, errors);
  checkRegistration(draft, errors);
  checkFee(draft, errors);
  return errors;
}

/**
 * The backend's field names of a refused save that belong to one control of
 * the form. The backend names weeks and time models by position; the form
 * has one day, one care time and one price for all its schools.
 */
export function extraDayServerFields(
  control: string,
  schoolCount: number,
): string[] {
  const perSchool = (suffixes: readonly string[]) =>
    Array.from({ length: schoolCount }, (_, index) =>
      suffixes.map((suffix) => `weeks.${index}.${suffix}`),
    ).flat();
  switch (control) {
    case "date":
      return perSchool(["starts_on", "ends_on"]);
    case "schools":
      return ["weeks", ...perSchool(["host_school_id"])];
    case "starts_at":
      return perSchool(["time_models.0.starts_at"]);
    case "ends_at":
      return perSchool(["time_models.0.ends_at"]);
    case "price":
      return ["included_in_fee", ...perSchool(["time_models.0.price_cents"])];
    default:
      return [control];
  }
}

/** A day on which a chosen school gives no care. */
export interface ExtraDayNoCare {
  readonly schoolId: string;
  readonly kind: "holiday" | "closing_day";
  readonly name: string;
}

/**
 * The chosen schools that give no care on the day, by the Träger's calendar:
 * a statutory holiday of the school's federal state or a closing day the
 * Träger planned for it (#4702). The backend checks again and also knows the
 * closing days a school entered itself.
 */
export function extraDayNoCare(
  date: string,
  schoolIds: readonly string[],
  calendar: TraegerCalendar | undefined,
): ExtraDayNoCare[] {
  if (!calendar || !isValidISODate(date)) return [];
  const found: ExtraDayNoCare[] = [];
  for (const schoolId of schoolIds) {
    const state = calendar.schools.find(
      (school) => school.id === schoolId,
    )?.federalStateCode;
    const holiday = calendar.regions
      .find((region) => region.code === state)
      ?.holidays.find((entry) => entry.date === date);
    if (holiday) {
      found.push({ schoolId, kind: "holiday", name: holiday.name });
      continue;
    }
    const closing = calendar.closingDays.find(
      (day) =>
        day.schoolIds.includes(schoolId) &&
        day.startDate <= date &&
        date <= day.endDate,
    );
    if (closing) {
      found.push({ schoolId, kind: "closing_day", name: closing.reason });
    }
  }
  return found;
}

// --- Display ---

/** "Fr., 22.05.2026", or „–“ while the day has no school yet. */
export function extraDayDate(period: HolidayPeriod): string {
  const date = period.weeks[0]?.startsOn;
  return date ? formatDayWithWeekday(date) : "–";
}

/** "07:30 bis 16:00 Uhr", or „–“ without a care time. */
export function extraDayCareTime(period: HolidayPeriod): string {
  const careTime = offeredCareTime(period);
  return careTime ? `${careTime.startsAt} bis ${careTime.endsAt} Uhr` : "–";
}

/** What the day costs parents. */
export function extraDayFee(period: HolidayPeriod): string {
  if (period.includedInFee) return "Im Monatsbeitrag enthalten";
  const careTime = offeredCareTime(period);
  return careTime ? `${formatEuro(careTime.priceCents)} pro Tag` : "–";
}

/** Children with a place at all schools of the day together. */
export function extraDayPlaced(period: HolidayPeriod): number {
  return period.weeks.reduce((sum, week) => sum + (week.placed ?? 0), 0);
}

/** "1 Schule" or "3 Schulen". */
export function extraDaySchoolCount(period: HolidayPeriod): string {
  const count = period.weeks.length;
  return count === 1 ? "1 Schule" : `${count} Schulen`;
}

/** The extra days of the periods, the next day first. */
export function extraDaysOf(
  periods: readonly HolidayPeriod[],
): HolidayPeriod[] {
  return periods
    .filter((period) => period.kind === "extra_day")
    .sort((a, b) =>
      (a.weeks[0]?.startsOn ?? "").localeCompare(b.weeks[0]?.startsOn ?? ""),
    );
}
