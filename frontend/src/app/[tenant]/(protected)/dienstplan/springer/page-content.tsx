"use client";

// Springer aus dem Vertretungspool des Trägers (#4709, ADR 0089 §9). Die
// OGS-Leitung sieht die Springer ihres Trägers mit dem Stand der Nachweise
// und blockt sie für einen Tag und eine Zeit. Sie sieht, wann eine andere
// Schule eine Person schon geblockt hat, nur mit dem Namen dieser Schule.

import { LockKeyIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

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
import { useToast } from "~/contexts/ToastContext";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { fetchSchoolPoolWeek, liftSchoolBlock } from "~/lib/staff-pool-api";
import { useSWRAuth } from "~/lib/swr";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";

const INFO = (
  <div className="space-y-2">
    <p>
      Springer sind Fachkräfte deines Trägers, die an jeder seiner Schulen
      einspringen. Blocke eine Person für einen Tag und eine Zeit.
    </p>
    <p>
      Eine Person ist zu jeder Zeit nur für eine Schule geblockt. Andere Schulen
      sehen nur, dass deine Schule geblockt hat, keinen Grund und keine Gruppe.
    </p>
  </div>
);

function StaffPoolContent() {
  const today = useBerlinToday();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [blocking, setBlocking] = useState<BlockSpringerTarget | null>(null);
  const [lifting, setLifting] = useState<LiftBlockTarget | null>(null);
  const { success } = useToast();
  const {
    data: week,
    error: weekError,
    mutate,
  } = useSWRAuth(
    tenantDailyKeys.springerWeek(weekStart),
    () => fetchSchoolPoolWeek(weekStart),
    { keepPreviousData: false },
  );
  const pageLoad = useSwrResourceLoadError(
    [{ data: week, error: weekError }],
    "die Springer",
    () => mutate(),
  );

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
                    ? "Blockung deiner Schule"
                    : "Blockungen deiner Schule",
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
              void mutate();
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
              void mutate();
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
              description="Dein Träger legt Springer in den Personalakten an. Frage dort nach, wenn du jemanden brauchst."
            />
          ) : (
            <EmptyState
              icon={<LockKeyIcon className="h-12 w-12" aria-hidden="true" />}
              title="Dein Träger führt sein Personal nicht in moto."
              description="Dann gibt es hier keine Springer. Vertretungen planst du wie bisher im Dienstplan."
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
