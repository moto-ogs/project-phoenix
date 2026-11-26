import { isValidISODate, parseISODate, toISODate } from "~/lib/date-helpers";

export type WeekOffset = 0 | 1 | 2 | 3;
export const LAST_MEAL_PLAN_WEEK: WeekOffset = 3;

export function mondayISOFromOffset(
  todayISO: string,
  weekOffset: number,
): string {
  const base = parseISODate(todayISO);
  base.setDate(base.getDate() + weekOffset * 7);
  const offset = (base.getDay() + 6) % 7; // Mon=0 .. Sun=6
  base.setDate(base.getDate() - offset);
  return toISODate(base);
}

/**
 * Die Woche, die ein Link aus den Hinweisen öffnet (`?week=<Montag>`, #7145):
 * ihr Abstand zur aktuellen Woche, oder null für einen ungültigen Wert, eine
 * vergangene Woche oder eine Woche hinter der letzten erreichbaren.
 */
export function linkedWeekOffset(
  todayISO: string,
  week: string | undefined,
): WeekOffset | null {
  if (!week || !isValidISODate(week)) return null;
  const monday = mondayISOFromOffset(week, 0);
  for (let offset = 0; offset <= LAST_MEAL_PLAN_WEEK; offset++) {
    if (mondayISOFromOffset(todayISO, offset) === monday) {
      return offset as WeekOffset;
    }
  }
  return null;
}

/** Wie `linkedWeekOffset`; ohne erreichbare Woche öffnet die aktuelle. */
export function weekOffsetFromParam(
  todayISO: string,
  week: string | undefined,
): WeekOffset {
  return linkedWeekOffset(todayISO, week) ?? 0;
}
