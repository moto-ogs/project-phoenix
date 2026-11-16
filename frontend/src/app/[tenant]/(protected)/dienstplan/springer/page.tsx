"use client";

// Springer aus dem Vertretungspool des Trägers (#4709, ADR 0089 §9). Die
// OGS-Leitung sieht die Springer ihres Trägers mit dem Stand der Nachweise
// und blockt sie für einen Tag und eine Zeit. Sie sieht, wann eine andere
// Schule eine Person schon geblockt hat, nur mit dem Namen dieser Schule.

import { LockKeyIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BlockSpringerModal,
  type BlockSpringerTarget,
} from "~/components/staff-pool/block-springer-modal";
import {
  LiftBlockModal,
  type LiftBlockTarget,
} from "~/components/staff-pool/lift-block-modal";
import { PoolWeekGrid, poolDays } from "~/components/staff-pool/pool-week-grid";
import {
  addDaysISO,
  mondayOf,
  planningWeekLabel,
} from "~/components/traeger/planning/planning-format";
import { ModuleRouteGuard } from "~/components/tenant/module-route-guard";
import { EmptyState } from "~/components/ui/empty-state";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiLoadError, useToast } from "~/contexts/ToastContext";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import {
  fetchSchoolPoolWeek,
  liftSchoolBlock,
  type PoolWeek,
} from "~/lib/staff-pool-api";

const logger = createLogger({ component: "StaffPoolPage" });

const INFO = (
  <div className="space-y-2">
    <p>
      Springer sind Fachkräfte Ihres Trägers, die an jeder seiner Schulen
      einspringen. Blocken Sie eine Person für einen Tag und eine Zeit.
    </p>
    <p>
      Eine Person ist zu jeder Zeit nur für eine Schule geblockt. Andere Schulen
      sehen nur, dass Ihre Schule geblockt hat, keinen Grund und keine Gruppe.
    </p>
  </div>
);

function StaffPoolContent() {
  const today = useBerlinToday();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [week, setWeek] = useState<PoolWeek | null>(null);
  const [blocking, setBlocking] = useState<BlockSpringerTarget | null>(null);
  const [lifting, setLifting] = useState<LiftBlockTarget | null>(null);
  const pageLoad = useApiLoadError();
  const { show: showLoadError, clear: clearLoadError } = pageLoad;
  const { success } = useToast();

  // Die Woche, die zuletzt angefragt wurde: eine späte Antwort einer
  // vorigen Woche überschreibt sie nicht.
  const requested = useRef(weekStart);
  const load = useCallback(
    async (monday: string) => {
      requested.current = monday;
      try {
        const loaded = await fetchSchoolPoolWeek(monday);
        if (requested.current !== monday) return;
        setWeek(loaded);
        clearLoadError();
      } catch (err) {
        if (requested.current !== monday) return;
        logger.error("staff_pool_week_load_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        await showLoadError(err, {
          object: "die Springer",
          retry: () => void load(monday),
        });
      }
    },
    [clearLoadError, showLoadError],
  );

  useEffect(() => {
    void load(weekStart);
  }, [load, weekStart]);

  const shown = week?.weekStart === weekStart ? week : null;
  const days = useMemo(() => poolDays(weekStart), [weekStart]);
  const ownBlocks =
    shown?.springers.reduce(
      (sum, springer) =>
        sum +
        springer.blocks.filter((block) => block.own && !block.lifted).length,
      0,
    ) ?? 0;
  const loading = !shown && !pageLoad.error;
  const empty =
    shown !== null && (!shown.available || shown.springers.length === 0);

  return (
    <TenantPage
      title="Springer"
      info={INFO}
      back
      backHref="/dienstplan"
      backLabel="Zurück zum Dienstplan"
      stats={
        shown && shown.springers.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: shown.springers.length,
                label: "Springer",
              },
              {
                value: ownBlocks,
                label:
                  ownBlocks === 1
                    ? "Blockung Ihrer Schule"
                    : "Blockungen Ihrer Schule",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      searchSlot={
        shown?.available === false ? undefined : (
          <PlanningContextBar
            dateLabel={planningWeekLabel(weekStart)}
            onPrevious={() =>
              setWeekStart((current) => addDaysISO(current, -7))
            }
            onNext={() => setWeekStart((current) => addDaysISO(current, 7))}
            previousLabel="Vorherige Woche"
            nextLabel="Nächste Woche"
            previousTooltip="Zeigt die Woche davor."
            nextTooltip="Zeigt die Woche danach."
            withoutContextRow
            onToday={
              weekStart === mondayOf(today)
                ? undefined
                : () => setWeekStart(mondayOf(today))
            }
          />
        )
      }
      error={pageLoad.error}
      loading={loading}
      overlays={
        <>
          <BlockSpringerModal
            target={blocking}
            todayIso={today}
            onClose={() => setBlocking(null)}
            onBlocked={(message) => {
              setBlocking(null);
              success(message);
              void load(weekStart);
            }}
          />
          <LiftBlockModal
            target={lifting}
            mode="school"
            lift={liftSchoolBlock}
            onClose={() => setLifting(null)}
            onLifted={(message) => {
              setLifting(null);
              success(message);
              void load(weekStart);
            }}
          />
        </>
      }
    >
      {empty ? (
        <SectionCard>
          {shown.available ? (
            <EmptyState
              icon={<UsersThreeIcon className="h-12 w-12" aria-hidden="true" />}
              title="In dieser Woche sind keine Springer im Pool."
              description="Ihr Träger legt Springer in den Personalakten an. Fragen Sie dort nach, wenn Sie jemanden brauchen."
            />
          ) : (
            <EmptyState
              icon={<LockKeyIcon className="h-12 w-12" aria-hidden="true" />}
              title="Ihr Träger führt sein Personal nicht in moto."
              description="Dann gibt es hier keine Springer. Vertretungen planen Sie wie bisher im Dienstplan."
            />
          )}
        </SectionCard>
      ) : null}

      {shown && !empty ? (
        <PoolWeekGrid
          springers={shown.springers}
          days={days}
          todayIso={today}
          mode="school"
          onBlock={(springer, date) => setBlocking({ springer, date })}
          onOpenBlock={(springer, block) => setLifting({ springer, block })}
        />
      ) : null}
    </TenantPage>
  );
}

export default function StaffPoolPage() {
  return (
    <ModuleRouteGuard module="dienstplan" title="Springer">
      <StaffPoolContent />
    </ModuleRouteGuard>
  );
}
