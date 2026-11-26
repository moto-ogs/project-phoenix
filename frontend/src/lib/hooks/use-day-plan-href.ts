"use client";

import { useSession } from "next-auth/react";
import { useCallback, useMemo } from "react";

import { hasEffectiveAdminScope, isCaregiver } from "~/lib/auth-utils";
import { canOpenCarePlan } from "~/lib/care-plan-access";
import { STAFF_FLAT_PAGES } from "~/lib/section-navigation";
import { useTenantAwarePath } from "~/lib/tenant-path";

const TODAY_PATH = STAFF_FLAT_PAGES.tagesplan.href;
const CARE_PLAN_PATH = STAFF_FLAT_PAGES.carePlan.href;

/** Ein Weiterlink der Startseite: Ziel, Linktext und Erklärung (#6777). */
export interface HomeDayLink {
  readonly href: string;
  readonly label: string;
  /** Welche Seite der Link öffnet, als ein Satz. */
  readonly tooltip: string;
}

/**
 * Wohin „der Tag" für diese Person führt.
 *
 * Es gibt zwei Seiten für denselben Gegenstand, und wer welche sieht,
 * entscheidet die Seitenleiste: `/tagesplan` ist der Einstieg der
 * Betreuungskräfte in den laufenden Tag und für reine Adminkonten
 * ausgeblendet (`hideForAdmin`), weil die Leitung im vollen Betreuungsplan
 * arbeitet. Ein Konto mit beidem — Admin UND Betreuungskraft —
 * sieht den Tagesplan sehr wohl.
 *
 * Dieselbe Bedingung steht deshalb hier noch einmal: ein Weiterlink der
 * Startseite darf nicht auf eine Seite zeigen, die diese Person in ihrer
 * Navigation gar nicht hat. Ändert sich die Regel in der Seitenleiste, gehört
 * sie hier mit geändert.
 */
export function useDayPlanLink(): HomeDayLink {
  const { data: session } = useSession();
  const tenantPath = useTenantAwarePath();
  // Ein reines Adminkonto: ohne „Heute“ in der Navigation. Die Seite trägt
  // je Rolle einen anderen Namen.
  const adminOnly = hasEffectiveAdminScope(session) && !isCaregiver(session);
  return useMemo(
    () =>
      adminOnly
        ? {
            href: tenantPath(CARE_PLAN_PATH),
            label: "Zum Betreuungsplan",
            tooltip: "Öffnet den Betreuungsplan der Schule.",
          }
        : {
            href: tenantPath(TODAY_PATH),
            label: "Heute öffnen",
            tooltip: "Öffnet deinen Tagesplan für heute.",
          },
    [adminOnly, tenantPath],
  );
}

/**
 * Wohin die Karte „Betreuungsplan heute“ führt (#8134).
 *
 * Die Karte trägt den Namen des Plans, also führt sie in den Plan: der
 * Weiterlink auf den Tag, jede Zeile in ihren geöffneten Termin. Dort sieht
 * man Team und Kinder; wer planen darf, sagt dort auch ab oder plant um. Das
 * gilt für alle, die den Plan als Seite haben (`canOpenCarePlan`), ob sie
 * planen oder nur lesen. „Mein Tag“ bleibt die Karte, von der aus man seine
 * Blöcke bedient, und führt weiter nach „Heute“.
 *
 * Wer den Plan nicht als Seite hat (die AG-Leitung mit `schedules:read`
 * allein), landet stattdessen im Tagesplan.
 */
export function useCarePlanTodayTarget(): {
  /** Führt die Karte in den Betreuungsplan (sonst nach „Heute“)? */
  readonly opensPlan: boolean;
  /** Der Text des Weiterlinks auf den Tag. */
  readonly label: string;
  /** Welche Seite der Weiterlink öffnet, als ein Satz (#6777). */
  readonly tooltip: string;
  /** Der Tag im Plan; ohne Datum der heutige. */
  readonly dayHref: (date?: string) => string;
  /** Der geöffnete Termin im Plan. */
  readonly blockHref: (block: {
    readonly date: string;
    readonly id: string;
  }) => string;
} {
  const { data: session } = useSession();
  const tenantPath = useTenantAwarePath();
  const opensPlan = canOpenCarePlan(session);
  const planHref = useCallback(
    (date?: string, blockId?: string) => {
      if (!opensPlan) return tenantPath(TODAY_PATH);
      const query = new URLSearchParams({ view: "tag" });
      if (date) query.set("d", date);
      if (blockId) query.set("block", blockId);
      return tenantPath(`${CARE_PLAN_PATH}?${query.toString()}`);
    },
    [opensPlan, tenantPath],
  );
  return useMemo(
    () => ({
      opensPlan,
      label: opensPlan ? "Plan öffnen" : "Heute öffnen",
      tooltip: opensPlan
        ? "Öffnet den Betreuungsplan von heute."
        : "Öffnet deinen Tagesplan für heute.",
      dayHref: (date) => planHref(date),
      blockHref: (block) => planHref(block.date, block.id),
    }),
    [opensPlan, planHref],
  );
}
