"use client";

import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { calendarPeriodService } from "~/lib/calendar-period-api";
import { findPeriodForDate } from "~/lib/calendar-period-helpers";
import { berlinTodayISO } from "~/lib/date-helpers";
import { useSWRAuth } from "~/lib/swr";
import { databaseKeys } from "~/lib/swr/portal-keys";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { timetableService } from "~/lib/timetable-api";

/**
 * Aufgabe auf der Startseite (#5103): Regeltermine, deren Kinderliste von
 * den Anmeldungen eines Betreuungsangebots abweicht. Der Link führt in die
 * Serienansicht mit „Zu prüfen“. Ohne Abweichung ist sie nicht da. Kann der
 * Zeitraum oder die Prüfung nicht gelesen werden, fehlt nur dieser Hinweis;
 * der Betreuungsplan zeigt ihn weiter an den Regelterminen.
 */
export function RosterDeviationTodos({
  enabled,
}: Readonly<{
  /** Recht am Betreuungsplan und Betreuungsplan eingeschaltet. */
  enabled: boolean;
}>) {
  const tenantPath = useTenantAwarePath();
  const { data: periods } = useSWRAuth(
    enabled ? databaseKeys.calendarPeriods() : null,
    () => calendarPeriodService.list(),
  );
  const period = periods ? findPeriodForDate(periods, berlinTodayISO()) : null;
  // Same cache entry as the Betreuungsplan, so both show the same count.
  const { data: deviations } = useSWRAuth(
    enabled && period ? tenantDailyKeys.rosterDeviations(period.id) : null,
    () => timetableService.getRosterDeviations(period?.id ?? ""),
  );

  const count = deviations?.length ?? 0;
  if (!enabled || count === 0) return null;
  return (
    <Alert
      type="warning"
      announce="polite"
      title="Regeltermine prüfen"
      message={
        count === 1
          ? "1 Regeltermin weicht von den Anmeldungen ab. Prüfe die Kinderliste."
          : `${count} Regeltermine weichen von den Anmeldungen ab. Prüfe die Kinderlisten.`
      }
      action={
        <ButtonLink
          href={tenantPath("/betreuungsplan?view=serien&pruefen=1")}
          variant="surface"
          size="md"
          tooltip="Öffnet im Betreuungsplan die Regeltermine, die abweichen."
        >
          Regeltermine prüfen
        </ButtonLink>
      }
    />
  );
}
