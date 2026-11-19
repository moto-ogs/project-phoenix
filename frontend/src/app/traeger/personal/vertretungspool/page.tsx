"use client";

// Vertretungspool des Trägers (#4709, ADR 0089 §9). Die Personalverwaltung
// sieht jede Person mit dem Merkmal „Vertretungspool“ im Arbeitsvertrag und
// jede Blockung einer Schule in der Woche. Sie hebt eine Blockung auf; die
// Schule sieht dann „Vom Träger aufgehoben“. Wer Springer ist, legt sie im
// Arbeitsvertrag der Personalakte fest.

import { UsersThreeIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

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
import { StaffNotReleasedPage } from "~/components/traeger/staff/staff-not-released-page";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerListExportItems } from "~/components/traeger/traeger-list-export-menu";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useToast } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  downloadTraegerPoolWeek,
  fetchTraegerPoolWeek,
  liftTraegerBlock,
} from "~/lib/staff-pool-api";

const NOT_RELEASED = "workforce.traeger_staff_not_released";

const INFO = (
  <div className="space-y-2">
    <p>
      Springer sind Personen mit dem Merkmal „Vertretungspool“ im
      Arbeitsvertrag. Jede deiner Schulen kann sie für einen Tag und eine Zeit
      blocken.
    </p>
    <p>
      Eine Person ist zu jeder Zeit nur für eine Schule geblockt. Du siehst jede
      Blockung und kannst sie aufheben.
    </p>
  </div>
);

export default function TraegerStaffPoolPage() {
  const today = useBerlinToday();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [lifting, setLifting] = useState<LiftBlockTarget | null>(null);
  const { success } = useToast();
  const {
    data: shown,
    error,
    failure,
    reload,
  } = useTraegerResource(
    traegerStaffKeys.poolWeek(weekStart),
    () => fetchTraegerPoolWeek(weekStart),
    "den Vertretungspool",
  );
  const notReleased =
    failure instanceof ApiError && failure.code === NOT_RELEASED;
  const loadError = notReleased ? null : error;

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
  const loading = !notReleased && !shown && !loadError;
  const exportItems = useTraegerListExportItems({
    download: (format) => downloadTraegerPoolWeek(weekStart, format),
    scope:
      "Alle Blockungen der Woche. Jeder Download steht im Zugriffsprotokoll der Schulen.",
    fallbackName: `vertretungspool-${weekStart}`,
    errorObject: "die Blockungen der Woche",
    unavailable: blockCount === 0,
  });

  if (notReleased) {
    return (
      <StaffNotReleasedPage
        title="Vertretungspool"
        description="Bis zur Freischaltung plant jede Schule ihre Vertretungen selbst."
      />
    );
  }

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
      overflowMenu={exportItems}
      searchSlot={
        <PlanningContextBar
          dateLabel={planningWeekLabel(weekStart)}
          onPrevious={() => setWeekStart((current) => addDaysISO(current, -7))}
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
      }
      error={loadError}
      loading={loading}
      empty={
        shown && shown.springers.length === 0
          ? {
              icon: <UsersThreeIcon className="h-12 w-12" aria-hidden="true" />,
              title: "In dieser Woche ist niemand im Vertretungspool.",
              description:
                "Setze im Arbeitsvertrag einer Personalakte das Merkmal „Vertretungspool“. Dann sehen alle deine Schulen die Person hier.",
            }
          : undefined
      }
      overlays={
        <LiftBlockModal
          target={lifting}
          mode="traeger"
          lift={liftTraegerBlock}
          onClose={() => setLifting(null)}
          onLifted={(message) => {
            setLifting(null);
            success(message);
            reload();
          }}
        />
      }
    >
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
