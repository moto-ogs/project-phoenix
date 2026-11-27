"use client";

import { useCallback } from "react";

import {
  dayChangeLinkHref,
  type DayChangesDay,
} from "~/components/home/day-changes-text";
import { trackEvent } from "~/lib/analytics";
import type { DayChangeLink } from "~/lib/day-changes";
import { useDayPlanLink } from "~/lib/hooks/use-day-plan-href";
import { useTenantAwarePath } from "~/lib/tenant-path";

function dayPlanHrefOnDay(href: string, day: string): string {
  const url = new URL(href, "https://moto.invalid");
  url.searchParams.set("d", day);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Wohin ein Eintrag von „Heute anders“ führt, mit Schulpräfix: für jede Zeile
 * der Karte derselbe Weg. Der Tagesplan heißt je Rolle anders (#7662): die
 * Leitung ohne Gruppe plant im Betreuungsplan (`useDayPlanLink`).
 */
export function useDayChangeHref(): (
  link: DayChangeLink | null,
  day?: DayChangesDay,
) => string | null {
  const tenantPath = useTenantAwarePath();
  const { href: dayPlanHref } = useDayPlanLink();
  return useCallback(
    (link, day = "today") => {
      // Die Kindakte kennt keinen angezeigten Kalendertag. Ein Link aus der
      // Vorschau würde dort deshalb fälschlich den heutigen Status zeigen.
      if (day === "tomorrow" && link?.target === "student") return null;
      const path = dayChangeLinkHref(link);
      if (path === null) return null;
      if (link?.target === "day_plan") {
        return day === "tomorrow" && link.day
          ? dayPlanHrefOnDay(dayPlanHref, link.day)
          : dayPlanHref;
      }
      return tenantPath(path);
    },
    [dayPlanHref, tenantPath],
  );
}

/** Klick auf einen Eintrag: nur die Art, nie Namen oder IDs. */
export function trackEntryClick(kind: string) {
  trackEvent("day_changes_entry_clicked", { day_change_kind: kind });
}
