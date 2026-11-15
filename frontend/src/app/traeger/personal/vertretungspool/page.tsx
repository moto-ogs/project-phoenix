"use client";

// Vertretungspool des Trägers (#4709, ADR 0089 §9). Die Personalverwaltung
// sieht jede Person mit dem Merkmal „Vertretungspool“ im Arbeitsvertrag und
// jede Blockung einer Schule in der Woche. Sie hebt eine Blockung auf; die
// Schule sieht dann „Vom Träger aufgehoben“. Wer Springer ist, legt sie im
// Arbeitsvertrag der Personalakte fest.

import { LockKeyIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LiftBlockModal,
  type LiftBlockTarget,
} from "~/components/staff-pool/lift-block-modal";
import { PoolWeekGrid, poolDays } from "~/components/staff-pool/pool-week-grid";
import {
  addDaysISO,
  mondayOf,
  planningWeekLabel,
  schoolColors,
} from "~/components/traeger/planning/planning-format";
import { EmptyState } from "~/components/ui/empty-state";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiLoadError, useToast } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import {
  fetchTraegerPoolWeek,
  liftTraegerBlock,
  type PoolWeek,
} from "~/lib/staff-pool-api";

const logger = createLogger({ component: "TraegerStaffPoolPage" });

const NOT_RELEASED = "workforce.traeger_staff_not_released";

const INFO = (
  <div className="space-y-2">
    <p>
      Springer sind Personen mit dem Merkmal „Vertretungspool“ im
      Arbeitsvertrag. Jede Ihrer Schulen kann sie für einen Tag und eine Zeit
      blocken.
    </p>
    <p>
      Eine Person ist zu jeder Zeit nur für eine Schule geblockt. Sie sehen jede
      Blockung und können sie aufheben.
    </p>
  </div>
);

export default function TraegerStaffPoolPage() {
  const today = useBerlinToday();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [week, setWeek] = useState<PoolWeek | null>(null);
  const [notReleased, setNotReleased] = useState(false);
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
        const loaded = await fetchTraegerPoolWeek(monday);
        if (requested.current !== monday) return;
        setWeek(loaded);
        setNotReleased(false);
        clearLoadError();
      } catch (err) {
        if (requested.current !== monday) return;
        if (err instanceof ApiError && err.code === NOT_RELEASED) {
          setNotReleased(true);
          clearLoadError();
          return;
        }
        logger.error("traeger_staff_pool_load_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        await showLoadError(err, {
          object: "den Vertretungspool",
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
  // Die Schulen der Woche, in der Reihenfolge ihres Namens, je mit Farbe.
  const schools = useMemo(() => {
    const byId = new Map<string, string>();
    for (const springer of shown?.springers ?? []) {
      for (const block of springer.blocks)
        byId.set(block.schoolId, block.schoolName);
    }
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [shown]);
  const colors = useMemo(() => schoolColors(schools), [schools]);
  const blockCount =
    shown?.springers.reduce(
      (sum, springer) => sum + springer.blocks.length,
      0,
    ) ?? 0;
  const loading = !notReleased && !shown && !pageLoad.error;

  return (
    <TenantPage
      title="Vertretungspool"
      info={INFO}
      stats={
        shown && shown.springers.length > 0 ? (
          <TenantPageStats
            items={[
              { value: shown.springers.length, label: "Springer" },
              {
                value: blockCount,
                label: blockCount === 1 ? "Blockung" : "Blockungen",
              },
              {
                value: schools.length,
                label: schools.length === 1 ? "Schule" : "Schulen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      searchSlot={
        notReleased ? undefined : (
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
        <LiftBlockModal
          target={lifting}
          mode="traeger"
          lift={liftTraegerBlock}
          onClose={() => setLifting(null)}
          onLifted={(message) => {
            setLifting(null);
            success(message);
            void load(weekStart);
          }}
        />
      }
    >
      {notReleased ? (
        <SectionCard>
          <EmptyState
            icon={<LockKeyIcon className="h-12 w-12" aria-hidden="true" />}
            title="Personal beim Träger ist noch nicht freigeschaltet."
            description="Das moto-Team schaltet es frei. Bis dahin plant jede Schule ihre Vertretungen selbst."
          />
        </SectionCard>
      ) : null}

      {shown && shown.springers.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<UsersThreeIcon className="h-12 w-12" aria-hidden="true" />}
            title="In dieser Woche ist niemand im Vertretungspool."
            description="Setzen Sie im Arbeitsvertrag einer Personalakte das Merkmal „Vertretungspool“. Dann sehen alle Ihre Schulen die Person hier."
          />
        </SectionCard>
      ) : null}

      {shown && shown.springers.length > 0 ? (
        <PoolWeekGrid
          springers={shown.springers}
          days={days}
          todayIso={today}
          mode="traeger"
          colors={colors}
          schools={schools}
          onOpenBlock={(springer, block) => setLifting({ springer, block })}
        />
      ) : null}
    </TenantPage>
  );
}
