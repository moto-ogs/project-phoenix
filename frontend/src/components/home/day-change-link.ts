"use client";

import { useCallback } from "react";

import { dayChangeLinkHref } from "~/components/home/day-changes-text";
import { trackEvent } from "~/lib/analytics";
import type { DayChangeLink } from "~/lib/day-changes";
import { useDayPlanLink } from "~/lib/hooks/use-day-plan-href";
import { useTenantAwarePath } from "~/lib/tenant-path";

/**
 * Wohin ein Eintrag von „Heute anders“ führt, mit Schulpräfix: für jede Zeile
 * der Karte derselbe Weg. Der Tagesplan heißt je Rolle anders (#7662): die
 * Leitung ohne Gruppe plant im Betreuungsplan (`useDayPlanLink`).
 */
export function useDayChangeHref(): (
  link: DayChangeLink | null,
) => string | null {
  const tenantPath = useTenantAwarePath();
  const { href: dayPlanHref } = useDayPlanLink();
  return useCallback(
    (link) => {
      const path = dayChangeLinkHref(link);
      if (path === null) return null;
      return link?.target === "day_plan" ? dayPlanHref : tenantPath(path);
    },
    [dayPlanHref, tenantPath],
  );
}

/** Klick auf einen Eintrag: nur die Art, nie Namen oder IDs. */
export function trackEntryClick(kind: string) {
  trackEvent("day_changes_entry_clicked", { day_change_kind: kind });
}
