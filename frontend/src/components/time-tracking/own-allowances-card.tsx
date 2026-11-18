"use client";

import { useEffect } from "react";

import {
  AllowanceCard,
  AllowanceExpiryNote,
} from "~/components/staff/allowance-card";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { ABSENCES_REFRESH_EVENT } from "~/lib/absence-helpers";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";
import { timeTrackingService } from "~/lib/time-tracking-api";

// Die eigenen Kontingente der schuleigenen Abwesenheitsarten (#4971): dieselben
// Karten wie im Reiter „Abwesenheiten“ der Leitung, nur ohne „Anspruch ändern“.
// Ohne Art mit Kontingent bleibt der Block weg; ein Ladefehler steht im Block,
// damit er nicht als „0 Tage“ gelesen wird.
export function OwnAllowancesCard() {
  const {
    data: allowances,
    error,
    mutate,
  } = useSWRAuth(staffAbsenceKeys.ownAllowances(), () =>
    timeTrackingService.getOwnAbsenceAllowances(),
  );
  const load = useSwrResourceLoadError(
    [{ data: allowances, error }],
    "die Übersicht der Kontingente",
    () => mutate(),
  );

  useEffect(() => {
    const reload = () => void mutate();
    window.addEventListener(ABSENCES_REFRESH_EVENT, reload);
    return () => window.removeEventListener(ABSENCES_REFRESH_EVENT, reload);
  }, [mutate]);

  if (!load.failure && (allowances === undefined || allowances.length === 0)) {
    return null;
  }

  return (
    <SectionCard
      title="Kontingente"
      description="Deine Tage je Abwesenheitsart. Den Anspruch trägt deine Leitung ein."
      // Wie die Urlaubskarte darüber: ohne shrink-0 staucht die Flex-Spalte
      // der Seite die Karte auf die Kopfhöhe (#4363).
      className="shrink-0"
      bodyClassName="compact:mt-4 mt-5 max-sm:mt-4"
    >
      {load.failure ? (
        <LoadErrorAlert error={load.error} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {(allowances ?? []).map((entry) => (
            <AllowanceCard
              key={entry.summary.absenceTypeId}
              title={entry.name}
              headingLevel={3}
              year={entry.summary.year}
              entitled={entry.summary.entitledDays}
              taken={entry.summary.takenDays}
              reserved={entry.summary.reservedDays}
              remaining={entry.summary.remainingDays}
              footer={<AllowanceExpiryNote summary={entry.summary} />}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
