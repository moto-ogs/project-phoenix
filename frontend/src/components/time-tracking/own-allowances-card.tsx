"use client";

import {
  AllowanceCard,
  AllowanceExpiryNote,
} from "~/components/staff/allowance-card";
import { SectionCard } from "~/components/ui/section-card";
import { formatDayCount } from "~/lib/absence-helpers";
import type { OwnLeaveAllowance } from "~/lib/contract/time-tracking.generated";

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

/** Was `AllowanceExpiryNote` zu einer Art braucht. */
function expirySummary(entry: OwnLeaveAllowance, year: number) {
  return {
    carriedIn: entry.carried_in
      ? {
          year: entry.carried_in.year,
          expiresOn:
            entry.carried_in.expires_on ?? `${entry.carried_in.year}-12-31`,
          expiredDays: entry.carried_in.expired_days,
          remainingDays: entry.carried_in.remaining_days,
        }
      : null,
    expiresOn: entry.expires_on ?? `${year}-12-31`,
    expiredDays: entry.expired_days,
    remainingDays: entry.remaining_days,
  };
}

// Die eigenen Kontingente der schuleigenen Abwesenheitsarten (#4971): dieselben
// Karten wie im Reiter „Abwesenheiten“ der Leitung, nur ohne „Anspruch ändern“.
// Ohne Art mit Kontingent bleibt der Block weg.
export function OwnAllowancesCard({
  allowances,
  year,
  app = false,
}: {
  readonly allowances: readonly OwnLeaveAllowance[];
  readonly year: number;
  /** App (#8070): eine Liste in der Karte statt Karten in der Karte. */
  readonly app?: boolean;
}) {
  if (allowances.length === 0) return null;

  if (app) {
    // Alle Arten wie auf dem Desktop, auch ohne Anspruch (#8070, Runde 7):
    // je Art eine Zeile mit allen vier Zahlen. Steht überall 0, ist die
    // Karte zugeklappt und sagt das im Untertitel (Runde 9).
    const empty = allowances.every(
      (entry) =>
        entry.entitled_days === 0 &&
        entry.taken_days === 0 &&
        entry.reserved_days === 0 &&
        entry.remaining_days === 0,
    );
    return (
      <SectionCard
        title="Kontingente"
        description={
          empty
            ? "Für dich ist noch kein Anspruch eingetragen. Das macht deine Leitung."
            : "Deine Tage je Abwesenheitsart. Den Anspruch trägt deine Leitung ein."
        }
        collapsible={empty}
        defaultCollapsed={empty}
        bodyClassName="mt-3"
      >
        <ul className="-mb-1 divide-y divide-gray-100">
          {allowances.map((entry) => (
            <AppAllowanceRow
              key={entry.absence_type_id}
              entry={entry}
              year={year}
            />
          ))}
        </ul>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Kontingente"
      description="Deine Tage pro Abwesenheitsart. Den Anspruch trägt deine Leitung ein."
      // Wie die Urlaubskarte darüber: ohne shrink-0 staucht die Flex-Spalte
      // der Seite die Karte auf die Kopfhöhe (#4363).
      className="shrink-0"
      bodyClassName="compact:mt-4 mt-5 max-sm:mt-4"
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {allowances.map((entry) => (
          <AllowanceCard
            key={entry.absence_type_id}
            title={entry.name}
            headingLevel={3}
            year={year}
            entitled={entry.entitled_days}
            taken={entry.taken_days}
            reserved={entry.reserved_days}
            remaining={entry.remaining_days}
            footer={
              <AllowanceExpiryNote summary={expirySummary(entry, year)} />
            }
          />
        ))}
      </div>
    </SectionCard>
  );
}

function AppAllowanceRow({
  entry,
  year,
}: {
  readonly entry: OwnLeaveAllowance;
  readonly year: number;
}) {
  const hint = termHint(entry.name);
  const figures = [
    `Anspruch ${formatDayCount(entry.entitled_days)}`,
    `genommen ${formatDayCount(entry.taken_days)}`,
    `vorgemerkt ${formatDayCount(entry.reserved_days)}`,
  ];
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 text-base leading-6 font-medium text-gray-900">
          {entry.name}
        </h3>
        <p className="shrink-0 text-right text-sm leading-6 text-gray-500 tabular-nums">
          <span className="font-semibold text-gray-900">
            {formatDayCount(entry.remaining_days)}
          </span>{" "}
          übrig
        </p>
      </div>
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
        <AllowanceExpiryNote summary={expirySummary(entry, year)} />
      </div>
    </li>
  );
}
