"use client";

// Das Wochenraster des Vertretungspools (#4709): die Springer untereinander,
// Montag bis Freitag nebeneinander, in jeder Zelle die Blockungen des Tages.
// In der Schule ist die eigene Blockung grün und öffnet das Aufheben; eine
// Blockung einer anderen Schule ist grau, nennt nur die Schule und ist nicht
// klickbar. Ein freier Tag ab heute im Pool trägt die Geste zum Blocken.
// Beim Träger trägt jede Blockung die Farbe ihrer Schule und öffnet das
// Aufheben. Unter lg zeigt die Fläche einen Tag mit allen Springern, wie die
// Einsatzplanung. Das Raster lädt nichts; alles kommt als Props.

import { CalendarXIcon } from "@phosphor-icons/react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { PlanAddAffordance } from "~/components/ui/planning/plan-add-affordance";
import { PlanBlock } from "~/components/ui/planning/plan-block";
import {
  PlanLegend,
  type PlanLegendEntry,
} from "~/components/ui/planning/plan-legend";
import { PlanningDayChip } from "~/components/ui/planning/planning-context-bar";
import {
  ResourceGrid,
  type ResourceGridColumn,
} from "~/components/ui/planning/resource-grid";
import { SectionCard } from "~/components/ui/section-card";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { Tooltip } from "~/components/ui/tooltip";
import { addDaysISO } from "~/components/traeger/planning/planning-format";
import { formatDate } from "~/lib/date-helpers";
import { BELOW_LG, useMediaQuery } from "~/lib/hooks/use-media-query";
import { LOCATION_COLORS } from "~/lib/location-helper";
import {
  inPool,
  proofSummary,
  type PoolBlock,
  type PoolSpringer,
} from "~/lib/staff-pool-api";

/** Ein Tag des Rasters. */
export interface PoolDay {
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** "Mo" */
  readonly weekday: string;
  /** "23.11." */
  readonly label: string;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr"] as const;

/** Montag bis Freitag der Woche ab `monday`. */
export function poolDays(monday: string): PoolDay[] {
  return WEEKDAYS.map((weekday, index) => {
    const date = addDaysISO(monday, index);
    const [, month, day] = date.split("-");
    return { date, weekday, label: `${day}.${month}.` };
  });
}

const PROOF_TONES: Record<
  ReturnType<typeof proofSummary>["tone"],
  StatusBadgeTone
> = {
  success: "green",
  warning: "warning",
  danger: "red",
  neutral: "gray",
};

const PROOF_WORDS = {
  complete: "vorhanden",
  missing: "fehlt",
  expiring: "läuft ab",
} as const;

/** „Führungszeugnis: vorhanden. Masernschutz: fehlt.“ */
function proofDetails(springer: PoolSpringer): string {
  if (springer.proofs.length === 0) {
    return "Der Träger verlangt für diese Person keine Nachweise.";
  }
  return springer.proofs
    .map((proof) => {
      const until =
        proof.status !== "missing" && proof.expiresOn
          ? ` bis ${formatDate(proof.expiresOn)}`
          : "";
      return `${proof.typeName}: ${PROOF_WORDS[proof.status]}${until}.`;
    })
    .join(" ");
}

const fullName = (springer: PoolSpringer) =>
  `${springer.lastName}, ${springer.firstName}`;

function RowHeader({ springer }: { readonly springer: PoolSpringer }) {
  const summary = proofSummary(springer.proofs);
  const details = proofDetails(springer);
  return (
    <div className="min-w-0">
      <span className="block truncate text-sm font-medium text-gray-900">
        {fullName(springer)}
      </span>
      <Tooltip className="mt-0.5 block w-fit" content={details}>
        <StatusBadge
          size="xs"
          tone={PROOF_TONES[summary.tone]}
          label={summary.label}
          title={details}
        />
      </Tooltip>
      {springer.poolUntil ? (
        <span className="mt-0.5 block truncate text-xs text-gray-500">
          Im Pool bis {formatDate(springer.poolUntil)}
        </span>
      ) : null}
    </div>
  );
}

/** Die Geste zum Blocken unter den Blockungen einer Zelle. */
function BlockButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group flex w-full rounded-md focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:outline-none"
    >
      <PlanAddAffordance size="inline" />
    </button>
  );
}

const NO_SCHOOLS: readonly { readonly id: string; readonly name: string }[] =
  [];

interface PoolWeekGridProps {
  readonly springers: readonly PoolSpringer[];
  readonly days: readonly PoolDay[];
  readonly todayIso: string;
  /**
   * `school`: die Sicht einer Schule, die blockt. `traeger`: die
   * Personalverwaltung, die jede Blockung sieht und aufhebt.
   */
  readonly mode: "school" | "traeger";
  /** Schul-ID → Farbe, nur beim Träger. */
  readonly colors?: ReadonlyMap<string, string>;
  /** Schulen in der Legende, nur beim Träger. */
  readonly schools?: readonly { readonly id: string; readonly name: string }[];
  /** Einen freien Tag blocken (nur in der Schule). */
  readonly onBlock?: (springer: PoolSpringer, date: string) => void;
  /** Eine Blockung öffnen, die die Sicht aufheben darf. */
  readonly onOpenBlock: (springer: PoolSpringer, block: PoolBlock) => void;
}

export function PoolWeekGrid({
  springers,
  days,
  todayIso,
  mode,
  colors,
  schools = NO_SCHOOLS,
  onBlock,
  onOpenBlock,
}: PoolWeekGridProps) {
  const scrollHintId = useId();
  const isCompact = useMediaQuery(BELOW_LG);
  const todayIndex = days.findIndex((day) => day.date === todayIso);
  const [mobileIndex, setMobileIndex] = useState(
    todayIndex >= 0 ? todayIndex : 0,
  );
  const safeMobileIndex = Math.min(Math.max(mobileIndex, 0), days.length - 1);

  const columns: ResourceGridColumn[] = useMemo(
    () =>
      days.map((day) => ({
        key: day.date,
        label: day.weekday,
        sublabel: day.label,
        isCurrent: day.date === todayIso,
        isMuted: day.date < todayIso,
      })),
    [days, todayIso],
  );

  const blocksByDay = useMemo(() => {
    const result = new Map<string, PoolBlock[]>();
    for (const springer of springers) {
      for (const block of springer.blocks) {
        const key = `${springer.recordId}|${block.date}`;
        result.set(key, [...(result.get(key) ?? []), block]);
      }
    }
    return result;
  }, [springers]);

  const legendEntries: PlanLegendEntry[] = useMemo(() => {
    if (mode === "traeger") {
      const used = new Set(
        springers.flatMap((springer) =>
          springer.blocks.map((block) => block.schoolId),
        ),
      );
      return schools
        .filter((school) => used.has(school.id))
        .map((school) => ({
          key: school.id,
          label: school.name,
          color: colors?.get(school.id),
        }));
    }
    return [
      {
        key: "own",
        label: "Von deiner Schule geblockt",
        color: LOCATION_COLORS.GROUP_ROOM,
      },
      {
        key: "other",
        label: "Von einer anderen Schule geblockt",
        color: LOCATION_COLORS.UNKNOWN,
      },
    ];
  }, [colors, mode, schools, springers]);

  const canBlock = (springer: PoolSpringer, date: string) =>
    mode === "school" &&
    !!onBlock &&
    date >= todayIso &&
    inPool(springer, date);

  const blockLabel = (springer: PoolSpringer, column: ResourceGridColumn) =>
    `${springer.firstName} ${springer.lastName} am ${column.label} ${column.sublabel ?? ""} blocken`.trim();

  const renderBlock = (springer: PoolSpringer, block: PoolBlock) => {
    const timeRange = `${block.startTime}–${block.endTime}`;
    if (mode === "traeger") {
      return (
        <PlanBlock
          key={`${block.id}`}
          size="compact"
          timeRange={timeRange}
          label="Geblockt"
          color={colors?.get(block.schoolId)}
          compactDetail={
            <span className="block truncate text-xs text-gray-600">
              {block.schoolName}
            </span>
          }
          title={`${timeRange}, geblockt von ${block.schoolName}`}
          interactive
          onClick={() => onOpenBlock(springer, block)}
          details="Blockung aufheben"
        />
      );
    }
    if (block.own && block.lifted) {
      return (
        <PlanBlock
          key={`lifted-${block.id ?? `${block.date}-${block.startTime}`}`}
          size="compact"
          timeRange={timeRange}
          label="Vom Träger aufgehoben"
          color={LOCATION_COLORS.GROUP_ROOM}
          status="cancelled"
          title={`${timeRange}: dein Träger hat diese Blockung aufgehoben. Die Zeit ist wieder frei.`}
        />
      );
    }
    if (block.own) {
      return (
        <PlanBlock
          key={`own-${block.id}`}
          size="compact"
          timeRange={timeRange}
          label="Deine Schule"
          color={LOCATION_COLORS.GROUP_ROOM}
          title={`${timeRange}, von deiner Schule geblockt`}
          interactive
          onClick={() => onOpenBlock(springer, block)}
          details="von deiner Schule geblockt. Blockung aufheben"
        />
      );
    }
    return (
      <PlanBlock
        key={`other-${block.schoolId}-${block.startTime}`}
        size="compact"
        timeRange={timeRange}
        label="Geblockt"
        color={LOCATION_COLORS.UNKNOWN}
        compactDetail={
          <span className="block truncate text-xs text-gray-600">
            {block.schoolName}
          </span>
        }
        title={`${timeRange}, geblockt von ${block.schoolName}`}
        // Another school's block is shown, not opened: no button (#7112).
        interactive={false}
      />
    );
  };

  const renderCell = (
    springer: PoolSpringer,
    column: ResourceGridColumn,
  ): ReactNode => {
    const blocks = blocksByDay.get(`${springer.recordId}|${column.key}`) ?? [];
    const blockable = canBlock(springer, column.key);
    if (blocks.length === 0) {
      if (blockable) return null;
      if (!inPool(springer, column.key)) {
        return (
          <span className="flex flex-1 items-center justify-center gap-1 text-xs text-gray-500">
            <CalendarXIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Nicht im Pool
          </span>
        );
      }
      return <span className="sr-only">Vorbei</span>;
    }
    return (
      <div className="flex flex-col gap-1">
        {blocks.map((block) => renderBlock(springer, block))}
        {blockable && onBlock ? (
          <BlockButton
            label={blockLabel(springer, column)}
            onClick={() => onBlock(springer, column.key)}
          />
        ) : null}
      </div>
    );
  };

  const legend =
    legendEntries.length > 0 ? (
      <PlanLegend entries={legendEntries} aria-label="Legende Blockungen" />
    ) : undefined;

  const mobileColumn = columns[safeMobileIndex];
  if (isCompact && mobileColumn) {
    return (
      <SectionCard padding="none">
        <div className="flex gap-1 border-b border-gray-200 p-2">
          {columns.map((column, index) => (
            <PlanningDayChip
              key={column.key}
              stacked
              weekdayLabel={column.label}
              dateLabel={column.sublabel ?? ""}
              selected={index === safeMobileIndex}
              onClick={() => setMobileIndex(index)}
              today={column.isCurrent}
            />
          ))}
        </div>
        <ul className="divide-y divide-gray-100">
          {springers.map((springer) => (
            <li key={springer.recordId} className="px-3 py-2.5">
              <RowHeader springer={springer} />
              <div className="mt-1.5">
                {renderCell(springer, mobileColumn) ??
                  (onBlock ? (
                    <BlockButton
                      label={blockLabel(springer, mobileColumn)}
                      onClick={() => onBlock(springer, mobileColumn.key)}
                    />
                  ) : null)}
              </div>
            </li>
          ))}
        </ul>
        {legend ? (
          <div className="border-t border-gray-200 px-3 py-2">{legend}</div>
        ) : null}
      </SectionCard>
    );
  }

  return (
    <div>
      <p id={scrollHintId} className="mb-2 text-xs text-gray-600 sm:hidden">
        Wische zur Seite, um weitere Tage zu sehen.
      </p>
      <ResourceGrid
        columns={columns}
        rows={springers}
        getRowKey={(springer) => springer.recordId}
        renderRowHeader={(springer) => <RowHeader springer={springer} />}
        renderCell={renderCell}
        columnMode="days"
        cornerHeader="Springer"
        scrollHintId={scrollHintId}
        emptyCellLabel={mode === "school" ? blockLabel : undefined}
        onEmptyCellClick={
          mode === "school" && onBlock
            ? (springer, column) => onBlock(springer, column.key)
            : undefined
        }
        ariaLabel="Vertretungspool, Woche aller Springer"
        legend={legend}
      />
    </div>
  );
}
