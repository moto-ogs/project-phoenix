// Was sich zwischen zwei Fassungen eines Betreuungsvertrags ändert (#4816):
// je Wochentag die Betreuung bisher und neu. Eltern sehen das, bevor sie
// die geänderte Fassung unterschreiben.

import { contractWeekdays } from "./care-contract-weekdays";
import type { Weekday } from "./traeger-care-contracts-api";

/** One booked module of a day, as both versions name it. */
export interface CareOfDay {
  readonly weekday: Weekday;
  readonly moduleName: string;
  readonly endsAt: string;
  readonly lastDay: string | null;
}

/** How a weekday changes: care added, dropped, other care, or the same. */
export type DayChangeKind = "same" | "added" | "dropped" | "changed";

export interface DayChange<Care extends CareOfDay = CareOfDay> {
  readonly weekday: Weekday;
  readonly kind: DayChangeKind;
  readonly before: readonly Care[];
  readonly after: readonly Care[];
}

function careKey(care: readonly CareOfDay[]): string {
  return care
    .map(
      (entry) => `${entry.moduleName}|${entry.endsAt}|${entry.lastDay ?? ""}`,
    )
    .sort((a, b) => a.localeCompare(b))
    .join(";");
}

function kindOf(
  before: readonly CareOfDay[],
  after: readonly CareOfDay[],
): DayChangeKind {
  if (careKey(before) === careKey(after)) return "same";
  if (before.length === 0) return "added";
  if (after.length === 0) return "dropped";
  return "changed";
}

/**
 * Every weekday of both versions with its care before and after, Monday
 * first. A weekend day shows only when one of the versions books it.
 */
export function careChanges<Care extends CareOfDay>(
  before: readonly Care[],
  after: readonly Care[],
): DayChange<Care>[] {
  const weekdays = contractWeekdays(
    after,
    before.map((care) => care.weekday),
  );
  return weekdays.map((weekday) => {
    const was = before.filter((care) => care.weekday === weekday);
    const is = after.filter((care) => care.weekday === weekday);
    return { weekday, kind: kindOf(was, is), before: was, after: is };
  });
}
