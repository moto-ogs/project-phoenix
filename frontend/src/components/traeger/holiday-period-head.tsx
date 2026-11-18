"use client";

// Der gemeinsame Kopf eines Ferienzeitraums (#5146): „Planung“, „Formular“
// (#5198), „Anmeldungen“ und „Plätze“ (#4699) sind Reiter derselben Sache,
// jeder mit eigener Adresse. Vergibt der Zeitraum seine Plätze nach Kriterien
// (#4700), kommt der Reiter „Vergabe“ dazu.
// Der Status steht als Plakette neben der Kopfaktion, auf allen Reitern
// gleich; die Statuszeile trägt nur Angaben (#7402).

import { StatusBadge } from "~/components/ui/status-badge";
import type { TenantPageProps } from "~/components/ui/tenant-page";
import type { HolidayAllocationMode, HolidayPeriod } from "~/lib/traeger-api";
import { traegerPath } from "~/lib/traeger-url";
import { formatDateRange, holidayStatusLabel } from "./holiday-period-format";

/** Was ein Klick auf die Kriterien der Platzvergabe tut (#6747). */
export const HOLIDAY_CRITERIA_HINT =
  "Öffnet die Kriterien für alle Ferien mit Vergabe nach Kriterien.";

export type HolidayPeriodTab =
  "planung" | "formular" | "anmeldungen" | "plaetze" | "vergabe";

/** Die Reiter eines Ferienzeitraums; jeder führt auf seine eigene Seite. */
export function holidayPeriodTabs(
  periodId: string,
  active: HolidayPeriodTab,
  registrationCount?: number,
  allocationMode?: HolidayAllocationMode,
): NonNullable<TenantPageProps["tabs"]> {
  return {
    value: active,
    // Die Reiter sind Links; die Navigation übernimmt der Link selbst.
    onChange: () => undefined,
    label: "Bereiche des Ferienzeitraums",
    items: [
      {
        value: "planung",
        label: "Planung",
        href: traegerPath(`/traeger/ferien/${periodId}`),
      },
      {
        value: "formular",
        label: "Formular",
        href: traegerPath(`/traeger/ferien/${periodId}/formular`),
      },
      {
        value: "anmeldungen",
        label: "Anmeldungen",
        badge: registrationCount,
        href: traegerPath(`/traeger/ferien/${periodId}/anmeldungen`),
      },
      {
        value: "plaetze",
        label: "Plätze",
        href: traegerPath(`/traeger/ferien/${periodId}/plaetze`),
      },
      ...(allocationMode === "criteria" || active === "vergabe"
        ? [
            {
              value: "vergabe",
              label: "Vergabe",
              href: traegerPath(`/traeger/ferien/${periodId}/vergabe`),
            },
          ]
        : []),
    ],
  };
}

/** Der Status des Zeitraums als Plakette neben der Kopfaktion. */
export function HolidayPeriodStatusBadge({
  period,
}: Readonly<{ period: HolidayPeriod }>) {
  return (
    <StatusBadge
      label={holidayStatusLabel(period)}
      tone={period.status === "published" ? "green" : "gray"}
    />
  );
}

/**
 * Die Angaben der Statuszeile eines Zeitraums für `TenantPageStats`:
 * Anmeldefrist und, wenn gesetzt, die Grenze je Kind.
 */
export function holidayPeriodStats(period: HolidayPeriod): { label: string }[] {
  return [
    {
      label: `Anmeldung ${formatDateRange(
        period.registrationOpensOn,
        period.registrationClosesOn,
      )}`,
    },
    ...(period.maxDaysPerChild == null
      ? []
      : [{ label: `höchstens ${period.maxDaysPerChild} Tage je Kind` }]),
  ];
}
