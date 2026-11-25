"use client";

import {
  AllowanceCard,
  AllowanceExpiryNote,
} from "~/components/staff/allowance-card";
import { SectionCard } from "~/components/ui/section-card";
import type { OwnLeaveAllowance } from "~/lib/contract/time-tracking.generated";
// Die eigenen Kontingente der schuleigenen Abwesenheitsarten (#4971): dieselben
// Karten wie im Reiter „Abwesenheiten“ der Leitung, nur ohne „Anspruch ändern“.
// Ohne Art mit Kontingent bleibt der Block weg.
export function OwnAllowancesCard({
  allowances,
  year,
}: {
  readonly allowances: readonly OwnLeaveAllowance[];
  readonly year: number;
}) {
  if (allowances.length === 0) return null;

  return (
    <SectionCard
      title="Kontingente"
      description="Deine Tage je Abwesenheitsart. Den Anspruch trägt deine Leitung ein."
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
              <AllowanceExpiryNote
                summary={{
                  carriedIn: entry.carried_in
                    ? {
                        year: entry.carried_in.year,
                        expiresOn:
                          entry.carried_in.expires_on ??
                          `${entry.carried_in.year}-12-31`,
                        expiredDays: entry.carried_in.expired_days,
                        remainingDays: entry.carried_in.remaining_days,
                      }
                    : null,
                  expiresOn: entry.expires_on ?? `${year}-12-31`,
                  expiredDays: entry.expired_days,
                  remainingDays: entry.remaining_days,
                }}
              />
            }
          />
        ))}
      </div>
    </SectionCard>
  );
}
