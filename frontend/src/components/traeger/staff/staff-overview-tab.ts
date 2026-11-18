// Reiter der Personalakten (`/traeger/personal`) in der Adresse (#7377).
// Die Übersicht führt ihren Reiter als `?tab=…`; eine Unterseite, die man
// von dort öffnet (Einstellen, Import, Akte), bekommt ihn als `?from=…` mit
// und führt mit Abbrechen und Zurück auf genau diesen Reiter zurück. Nur die
// bekannten Reiter gelten, ein fremder Wert fällt auf die Übersicht ohne
// Reiter zurück: der Parameter wird nie als Pfad übernommen.

import { useSearchParams } from "next/navigation";
import { traegerPath } from "~/lib/traeger-url";

export const STAFF_OVERVIEW_TABS = [
  "vorschlaege",
  "akten",
  "ohne-akte",
] as const;

export type StaffOverviewTab = (typeof STAFF_OVERVIEW_TABS)[number];

const OVERVIEW = "/traeger/personal";

export function parseStaffOverviewTab(
  value: string | null | undefined,
): StaffOverviewTab | null {
  return STAFF_OVERVIEW_TABS.find((tab) => tab === value) ?? null;
}

/** Die Personalakten, auf dem Reiter `tab` oder ohne Angabe auf dem Standard. */
export function staffOverviewHref(tab: StaffOverviewTab | null): string {
  return traegerPath(tab ? `${OVERVIEW}?tab=${tab}` : OVERVIEW);
}

/**
 * Eine Unterseite der Personalakten (`/traeger/personal/…`), die sich den
 * Reiter merkt, von dem man kam.
 */
export function staffSubpageHref(
  path: string,
  from: StaffOverviewTab | null,
): string {
  return traegerPath(from ? `${path}?from=${from}` : path);
}

/**
 * Der Reiter, von dem man auf die Unterseite kam, und der Rückweg dorthin.
 * `useSearchParams` braucht auf der Seite eine Suspense-Grenze.
 */
export function useStaffOverviewReturn(): {
  readonly from: StaffOverviewTab | null;
  readonly backHref: string;
} {
  const searchParams = useSearchParams();
  const from = parseStaffOverviewTab(searchParams?.get("from"));
  return { from, backHref: staffOverviewHref(from) };
}
