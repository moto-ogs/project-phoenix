"use client";

import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { StatCard } from "~/components/ui/stat-card";
import { HomeCard, HomeCardIcon } from "~/components/home/home-card";
import { HomeCardLink } from "~/components/home/home-card-rows";
import type { DashboardAnalytics } from "~/lib/dashboard-helpers";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import {
  staffOverviewService,
  type DashboardSummary,
} from "~/lib/staff-overview-api";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { staffConcept } from "~/lib/concepts/staff";

const logger = createLogger({ component: "StaffTodayBlock" });

/**
 * Baustein „Personal heute" (#2180): der Teamstand aus Leitungssicht. Wie
 * viele in Aufsicht sind, ob die Stempeluhr läuft, wie groß das Team ist. Wer
 * heute fehlt, zeigt „Heute anders“ mit Namen (#7668).
 *
 * Die offenen Anträge stehen bewusst NICHT hier: sie zählen im Baustein
 * „Offene Anfragen", und zwei Karten mit derselben Zahl sagen nicht mehr als
 * eine.
 */
export function StaffTodayBlock({
  analytics,
}: {
  /** Betriebszahlen der Seite; ohne groups:read fehlt die Aufsicht schlicht. */
  readonly analytics: DashboardAnalytics | undefined;
}) {
  const tenantPath = useTenantAwarePath();
  const {
    data: summary,
    error,
    isLoading,
    mutate,
  } = useSWRAuth<DashboardSummary>(
    homeKeys.staffSummary(),
    () => staffOverviewService.getDashboardSummary("week"),
    { refreshInterval: 5 * 60 * 1000 },
  );

  if (error) {
    logger.error("home_staff_summary_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const loadError = useSwrLoadError(error, "die Karte „Personal heute“", () =>
    mutate(),
  );

  const tiles = staffTiles(summary, analytics);
  // Bis der Katalogtext des Ladefehlers da ist, stehen Striche statt Nullen.
  const pending = (isLoading || error !== undefined) && summary === undefined;

  return (
    <HomeCard
      title="Personal heute"
      leading={<HomeCardIcon concept={staffConcept} />}
      inlineActions
      actions={
        <HomeCardLink
          href={tenantPath("/staff")}
          label="Personal heute: zum Team"
          tooltip="Öffnet die Liste aller Mitarbeitenden."
        >
          Zum Team
        </HomeCardLink>
      }
    >
      {loadError ? (
        <LoadErrorAlert error={loadError} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {tiles.map((tile) => (
            <StatCard
              key={tile.label}
              variant="tile"
              label={tile.label}
              value={pending ? "–" : tile.value}
            />
          ))}
        </div>
      )}
    </HomeCard>
  );
}

interface StaffTile {
  readonly label: string;
  readonly value: string | number;
}

/**
 * Bis zu drei Zahlen. Krank und Urlaub stehen nicht mehr hier, sondern mit
 * Namen in „Heute anders“ (#7668): zwei Karten mit derselben Zahl sagen nicht
 * mehr als eine. Die Stempeluhr steht nur da, wo sie benutzt wird: „0 von 0"
 * neben „5 in Aufsicht" läse sich wie ein Widerspruch.
 */
export function staffTiles(
  summary: DashboardSummary | undefined,
  analytics: DashboardAnalytics | undefined,
): readonly StaffTile[] {
  const tiles: StaffTile[] = [];
  if (analytics) {
    tiles.push({ label: "In Aufsicht", value: analytics.supervisorsToday });
  }
  const expected = summary?.expectedClockedIn ?? 0;
  const clockedIn = summary?.currentlyClockedIn ?? 0;
  if (expected > 0 || clockedIn > 0) {
    tiles.push({
      label: "Eingestempelt",
      value: expected > 0 ? `${clockedIn} von ${expected}` : clockedIn,
    });
  }
  tiles.push({ label: "Team gesamt", value: summary?.activeStaffCount ?? 0 });
  return tiles;
}
