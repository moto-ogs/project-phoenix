"use client";

/**
 * Hinweis im Schließtag-Dialog der Schule (#6434): Liegt der Schließtag in
 * einer Ferienwoche, die die Schule für ihren Träger ausrichtet, nennt der
 * Dialog die Woche und wie viele Kinder dort einen Platz haben. Die Eltern
 * kennt nur der Träger. Nach dem Speichern schlägt moto einen Elternhinweis
 * vor, den die Schule oder das Träger-Büro mit einem Klick beauftragt
 * (ADR 0196). Die Zahlen kommen aus den Teilnehmerlisten (ADR 0116).
 */

import { isAccessRefusal } from "~/lib/access-refusal";
import type { ClosingDayDraft } from "~/components/planning/closing-day-modal";
import { ApiError } from "~/lib/api-error";
import {
  fetchHostedHolidayWeeks,
  type HostedHolidayWeek,
} from "~/lib/holiday-host-api";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { holidayKeys } from "~/lib/swr/portal-keys";

const logger = createLogger({ component: "ClosingDayHolidayHint" });

/** Die ausgerichteten Wochen mit Kindern, die den Zeitraum berühren. */
export function hostedWeeksInRange(
  weeks: readonly HostedHolidayWeek[],
  draft: ClosingDayDraft | null,
): HostedHolidayWeek[] {
  if (!draft?.startDate || !draft.endDate || draft.endDate < draft.startDate) {
    return [];
  }
  return weeks.filter(
    (week) =>
      week.participants > 0 &&
      week.startsOn <= draft.endDate &&
      week.endsOn >= draft.startDate,
  );
}

const EMPTY: readonly HostedHolidayWeek[] = [];

export function useHostedHolidayWeeks(open: boolean) {
  const { data } = useSWRAuth(
    // Derselbe Eintrag wie auf der Seite „Ferienwochen“.
    open ? holidayKeys.hostedWeeks() : null,
    fetchHostedHolidayWeeks,
    {
      // Bewusst still: Der Hinweis ergänzt den Dialog nur. Ohne Recht auf
      // die Teilnehmerlisten oder bei einem Fehler bleibt das Speichern
      // möglich, und der Träger sieht den Schließtag trotzdem.
      onError: (err: unknown) => {
        if (err instanceof ApiError && isAccessRefusal(err)) {
          return;
        }
        logger.warn("closing_day_hosted_weeks_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      },
    },
  );
  return data ?? EMPTY;
}
