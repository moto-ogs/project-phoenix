"use client";

import { useEffect } from "react";

import {
  AllowanceCard,
  AllowanceExpiryNote,
} from "~/components/staff/allowance-card";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { ABSENCES_REFRESH_EVENT, formatDayCount } from "~/lib/absence-helpers";
import type { OwnAbsenceAllowance } from "~/lib/time-tracking-api";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";
import { timeTrackingService } from "~/lib/time-tracking-api";

// Die eigenen Kontingente der schuleigenen Abwesenheitsarten (#4971): dieselben
// Karten wie im Reiter „Abwesenheiten“ der Leitung, nur ohne „Anspruch ändern“.
// Ohne Art mit Kontingent bleibt der Block weg; ein Ladefehler steht im Block,
// damit er nicht als „0 Tage“ gelesen wird.
// Bekannte Tarifbegriffe kurz erklärt (App, #8070). Die Namen legt die
// Schule oder der Träger selbst an; nur wo der Name ein feststehender Begriff
// aus dem Tarif für Erziehungsberufe ist, steht eine Erklärung darunter.
const TERM_HINTS: Readonly<Record<string, string>> = {
  regenerationstag: "Zusätzlicher freier Tag zur Erholung",
  umwandlungstag: "Freier Tag statt eines Teils deiner Zulage",
  // Wer im Urlaub krank wird, bekommt die Krankheitstage als Urlaub zurück.
  "krank-urlaubstag": "Urlaubstag zurück, weil du im Urlaub krank warst",
  "krank-urlaub": "Urlaubstage zurück, weil du im Urlaub krank warst",
};

function termHint(name: string): string | undefined {
  return TERM_HINTS[name.trim().toLowerCase()];
}

export function OwnAllowancesCard({
  app = false,
}: {
  /** App (#8070): eine Liste in der Karte statt Karten in der Karte. */
  readonly app?: boolean;
} = {}) {
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

  if (app) {
    // Alle Arten wie auf dem Desktop, auch ohne Anspruch (#8070, Runde 7):
    // je Art eine Zeile mit allen vier Zahlen.
    return (
      <SectionCard
        title="Kontingente"
        description="Deine Tage je Abwesenheitsart. Den Anspruch trägt deine Leitung ein."
        bodyClassName="mt-3"
      >
        {load.failure ? (
          <LoadErrorAlert error={load.error} />
        ) : (
          <ul className="-mb-1 divide-y divide-gray-100">
            {(allowances ?? []).map((entry) => (
              <AppAllowanceRow
                key={entry.summary.absenceTypeId}
                entry={entry}
              />
            ))}
          </ul>
        )}
      </SectionCard>
    );
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

function AppAllowanceRow({ entry }: { readonly entry: OwnAbsenceAllowance }) {
  const { summary } = entry;
  const hint = termHint(entry.name);
  const figures = [
    `Anspruch ${formatDayCount(summary.entitledDays)}`,
    `genommen ${formatDayCount(summary.takenDays)}`,
    `vorgemerkt ${formatDayCount(summary.reservedDays)}`,
  ];
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <h3 className="text-base leading-6 font-medium text-gray-900">
          {entry.name}
        </h3>
        {hint ? <p className="text-sm text-gray-500">{hint}</p> : null}
        <p className="flex flex-wrap gap-x-1 text-sm text-gray-500 tabular-nums">
          {figures.map((figure, index) => (
            <span key={figure} className="whitespace-nowrap">
              {index > 0 ? "· " : ""}
              {figure}
            </span>
          ))}
        </p>
        <div className="mt-0.5 empty:hidden">
          <AllowanceExpiryNote summary={summary} />
        </div>
      </div>
      <p className="shrink-0 text-right text-sm leading-6 text-gray-500 tabular-nums">
        <span className="font-semibold text-gray-900">
          {formatDayCount(summary.remainingDays)}
        </span>{" "}
        übrig
      </p>
    </li>
  );
}
