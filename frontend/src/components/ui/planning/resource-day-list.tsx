"use client";

import { useState, type ReactNode } from "react";

import { PlanningDayChip } from "~/components/ui/planning/planning-context-bar";
import type { ResourceGridColumn } from "~/components/ui/planning/resource-grid";
import { SectionCard } from "~/components/ui/section-card";

/**
 * ResourceDayList ist die Handy-Ansicht eines Wochenrasters (#7415): oben die
 * Tage als Chips, darunter jede Zeile mit ihrem Inhalt für den gewählten Tag,
 * unten die Legende. Wie `ResourceGrid` kennt sie keine Fachlichkeit: Zeilen,
 * Kopf und Zelle kommen vom Aufrufer. Die Einsatzplanung des Trägers und der
 * Vertretungspool zeigen damit unter lg denselben Aufbau.
 *
 * Der gewählte Tag beginnt bei der Spalte `isCurrent` (heute), sonst beim
 * ersten Tag.
 */
interface ResourceDayListProps<TRow> {
  /** Die Tage; `label` ist der Wochentag, `sublabel` das Datum. */
  readonly columns: readonly ResourceGridColumn[];
  readonly rows: readonly TRow[];
  readonly getRowKey: (row: TRow) => string;
  /** Name und Angaben der Zeile, wie im Zeilenkopf des Rasters. */
  readonly renderRowHeader: (row: TRow) => ReactNode;
  /**
   * Inhalt der Zeile am gewählten Tag. Eine leere Zeile gibt ihre
   * Anlege-Geste selbst zurück (`PlanAddButton`), oder `null`.
   */
  readonly renderCell: (row: TRow, column: ResourceGridColumn) => ReactNode;
  /** Legende unter der Liste. */
  readonly legend?: ReactNode;
}

export function ResourceDayList<TRow>({
  columns,
  rows,
  getRowKey,
  renderRowHeader,
  renderCell,
  legend,
}: ResourceDayListProps<TRow>) {
  const currentIndex = columns.findIndex((column) => column.isCurrent);
  const [selectedIndex, setSelectedIndex] = useState(
    currentIndex >= 0 ? currentIndex : 0,
  );
  const safeIndex = Math.min(Math.max(selectedIndex, 0), columns.length - 1);
  const selected = columns[safeIndex];

  return (
    <SectionCard padding="none">
      <div className="flex gap-1 border-b border-gray-200 p-2">
        {columns.map((column, index) => (
          <PlanningDayChip
            key={column.key}
            stacked
            weekdayLabel={column.label}
            dateLabel={column.sublabel ?? ""}
            selected={index === safeIndex}
            onClick={() => setSelectedIndex(index)}
            today={column.isCurrent}
          />
        ))}
      </div>
      {selected ? (
        <ul className="divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={getRowKey(row)} className="px-3 py-2.5">
              {renderRowHeader(row)}
              <div className="mt-1.5">{renderCell(row, selected)}</div>
            </li>
          ))}
        </ul>
      ) : null}
      {legend ? (
        <div className="border-t border-gray-200 px-3 py-2">{legend}</div>
      ) : null}
    </SectionCard>
  );
}
