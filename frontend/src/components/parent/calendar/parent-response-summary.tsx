"use client";

import { EyeSlashIcon } from "@phosphor-icons/react/ssr";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionLabel } from "~/components/ui/section-label";
import { Skeleton } from "~/components/ui/skeleton";
import { StatCard } from "~/components/ui/stat-card";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import {
  getParentAppointmentOverview,
  type CalendarEvent,
} from "~/lib/personal-calendar-api";

/**
 * Wie viele Eingeladene zu- und abgesagt haben, wenn die OGS die Übersicht
 * für alle Eingeladenen freigibt. Eltern sehen nur die Zahlen, nie Namen
 * oder Antworten anderer Eltern (#6846). Bei einer Reihe zählen die
 * Antworten für den geöffneten Termin (#6987). Die Zahlen laden beim Öffnen
 * der Details und nach der eigenen Antwort neu (der Kalender erneuert sie).
 */
export function ParentResponseSummary({
  event,
}: Readonly<{ event: CalendarEvent }>) {
  const t = useCareTermTranslations("parentCalendar");
  const appointmentId =
    event.can_view_overview &&
    event.delivery_mode === "rsvp_required" &&
    !event.cancelled
      ? event.appointment_id
      : undefined;
  const occurrenceDate = event.recurring ? event.occurrence_date : undefined;
  const overview = useSWRAuth(
    appointmentId
      ? parentKeys.appointmentOverview(appointmentId, occurrenceDate)
      : null,
    () => getParentAppointmentOverview(appointmentId ?? "", occurrenceDate),
    { keepPreviousData: false },
  );
  const counts = overview.data?.counts;
  const { error } = useSwrResourceLoadError(
    [overview],
    t("errorObjectOverview"),
    () => overview.mutate(),
  );

  if (!appointmentId) return null;

  const headingId = `parent-calendar-responses-${event.id}`;
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={!counts && !error}
      className="space-y-2 border-t border-gray-100 pt-3"
    >
      <SectionLabel as="h4" id={headingId}>
        {t("responses.title")}
      </SectionLabel>
      {error ? (
        <LoadErrorAlert error={error} />
      ) : counts ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              variant="tile"
              tone="green"
              value={counts.accepted}
              label={t("responses.accepted")}
            />
            <StatCard
              variant="tile"
              tone="red"
              value={counts.declined}
              label={t("responses.declined")}
            />
            <StatCard
              variant="tile"
              value={counts.pending}
              label={t("responses.pending")}
            />
          </div>
          <p className="flex items-center gap-1.5 text-xs leading-5 text-gray-500">
            <EyeSlashIcon size={14} className="shrink-0" aria-hidden="true" />
            {t("responses.privacy")}
          </p>
        </>
      ) : (
        <div className="grid grid-cols-3 gap-2" aria-hidden="true">
          <Skeleton shape="inner" className="h-12" />
          <Skeleton shape="inner" className="h-12" />
          <Skeleton shape="inner" className="h-12" />
        </div>
      )}
    </section>
  );
}
