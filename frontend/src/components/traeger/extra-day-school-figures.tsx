"use client";

// Die Zahlen eines Zusatztags pro Schule (#4817): wie viele Kinder dort
// einen Platz haben und wie viele Plätze es gibt. Reine Anzeige; Plätze und
// Warteliste pflegt der Reiter „Plätze“.

import { ButtonLink } from "~/components/ui/button";
import { SectionCard } from "~/components/ui/section-card";
import { StatCard } from "~/components/ui/stat-card";
import type { HolidayPeriod, TraegerSchool } from "~/lib/traeger-api";
import { traegerPath } from "~/lib/traeger-url";

export function ExtraDaySchoolFigures({
  period,
  schools,
}: Readonly<{
  period: HolidayPeriod;
  schools: readonly TraegerSchool[];
}>) {
  // A draft takes no registration yet: there is nothing to count.
  if (period.status !== "published") return null;
  const schoolName = (id: string) =>
    schools.find((school) => school.id === id)?.name ?? "Schule";
  return (
    <SectionCard
      title="Kinder pro Schule"
      description="Kinder mit Platz aus eingegangenen und bestätigten Anmeldungen."
      action={
        <ButtonLink
          href={traegerPath(`/traeger/ferien/${period.id}/plaetze`)}
          variant="outline"
          size="md"
          tooltip="Öffnet die Plätze und die Warteliste jeder Schule."
        >
          Plätze öffnen
        </ButtonLink>
      }
    >
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {period.weeks.map((week) => {
          const placed = week.placed ?? 0;
          const capacity = week.capacity ?? null;
          const full = capacity !== null && placed >= capacity;
          const name = schoolName(week.hostSchoolId);
          // The same reading as the day tiles of the page „Plätze“.
          const label =
            capacity === null
              ? `${name}: ${placed} angemeldet`
              : `${name}: ${placed} von ${capacity} Plätzen vergeben${full ? ", voll" : ""}`;
          return (
            <li key={week.id ?? week.hostSchoolId} aria-label={label}>
              <StatCard
                label={name}
                value={capacity === null ? placed : `${placed} von ${capacity}`}
                hint={
                  capacity === null
                    ? "Kinder angemeldet"
                    : full
                      ? "Voll"
                      : "Plätze vergeben"
                }
                tone={full ? "orange" : "green"}
                progressPct={
                  capacity === null
                    ? undefined
                    : Math.min(100, (placed / Math.max(capacity, 1)) * 100)
                }
              />
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
