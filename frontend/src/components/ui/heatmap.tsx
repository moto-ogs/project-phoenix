"use client";

import { useMemo, useState } from "react";
import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";
import { Z_LAYER } from "./overlay-styles";

/**
 * Eine Heatmap: Zeilen mal Spalten, jede Zelle so kräftig gefärbt, wie ihr
 * Wert groß ist (#4714). Gebaut als echte Tabelle, damit ein Screenreader
 * Zeile und Spalte jeder Zahl vorliest. Eine Farbe (`tone`) von hell nach
 * dunkel; null bleibt grau. Zahlen ab 1 stehen in der Zelle, der genaue Wert
 * in der Zeile unter dem Raster, sobald der Zeiger auf einer Zelle liegt.
 */

/** Hell nach dunkel, gleicher Farbton: die Stufen der Kit-Palette. */
const RAMPS = {
  green: [
    MOTO_COLOR_PALETTE.green.soft,
    MOTO_COLOR_PALETTE.green.muted,
    MOTO_COLOR_PALETTE.green.base,
    MOTO_COLOR_PALETTE.green.vivid,
    MOTO_COLOR_PALETTE.green.strong,
  ],
  blue: [
    MOTO_COLOR_PALETTE.blue.soft,
    "#B4CAF0",
    MOTO_COLOR_PALETTE.blue.light,
    MOTO_COLOR_PALETTE.blue.hover,
    MOTO_COLOR_PALETTE.blue.strong,
  ],
} as const;

export type HeatmapTone = keyof typeof RAMPS;

const INK_DARK = "#111827";
const INK_LIGHT = "#FFFFFF";

export interface HeatmapColumn {
  readonly key: string;
  /** Vorgelesen als Spaltenkopf, zum Beispiel „07:30 bis 08:00 Uhr“. */
  readonly label: string;
  /** Sichtbar über der Spalte; leer lässt den Strich weg. */
  readonly tick?: string;
}

export interface HeatmapRow {
  readonly key: string;
  /** Voller Name der Zeile, ab `sm` sichtbar. */
  readonly label: string;
  /** Kurzer Name auf dem Telefon, zum Beispiel „Mo“. */
  readonly shortLabel?: string;
  /** Eine Zeile Grau unter dem Namen, zum Beispiel „aus 4 Tagen“. */
  readonly meta?: string;
  /** Ein Wert je Spalte, in der Reihenfolge von `columns`. */
  readonly values: readonly number[];
}

export interface HeatmapCell {
  readonly row: number;
  readonly column: number;
}

interface HeatmapProps {
  /** Name der Tabelle für Screenreader. */
  readonly caption: string;
  readonly columns: readonly HeatmapColumn[];
  readonly rows: readonly HeatmapRow[];
  readonly tone: HeatmapTone;
  /** Die Zahl in der Zelle; leer lässt sie frei. */
  readonly formatValue: (value: number) => string;
  /** Ein Satz zur Zelle, vorgelesen und unter dem Raster gezeigt. */
  readonly describeCell: (
    row: HeatmapRow,
    column: HeatmapColumn,
    value: number,
  ) => string;
  /** Steht unter dem Raster, solange keine Zelle gewählt ist. */
  readonly summary?: string;
  /** Diese Zelle trägt einen Rahmen, etwa der Höchstwert. */
  readonly highlight?: HeatmapCell | null;
  /** Beschriftung der Legende, zum Beispiel „0“ und „24 Kinder“. */
  readonly legend: { readonly low: string; readonly high: string };
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Die Farbe an der Stelle `t` (0 bis 1) der Stufen. */
function rampColor(ramp: readonly string[], t: number): string {
  const position = Math.min(Math.max(t, 0), 1) * (ramp.length - 1);
  const index = Math.min(Math.floor(position), ramp.length - 2);
  const from = channels(ramp[index] ?? INK_LIGHT);
  const to = channels(ramp[index + 1] ?? INK_LIGHT);
  const share = position - index;
  return toHex(from.map((c, i) => c + ((to[i] ?? c) - c) * share));
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Dunkle oder weiße Schrift, je nachdem, welche sich besser abhebt. */
function inkOn(background: string): string {
  return contrast(INK_DARK, background) >= contrast(INK_LIGHT, background)
    ? INK_DARK
    : INK_LIGHT;
}

/**
 * Die Stelle eines Werts auf den Stufen. Die Wurzel hebt kleine Werte an, damit
 * neben einer Spitze auch wenige Kinder sichtbar bleiben; die Zahl in der Zelle
 * nennt den genauen Wert.
 */
function shareOf(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return 0.12 + 0.88 * Math.sqrt(Math.min(value / max, 1));
}

export function Heatmap({
  caption,
  columns,
  rows,
  tone,
  formatValue,
  describeCell,
  summary,
  highlight = null,
  legend,
}: HeatmapProps) {
  const ramp = RAMPS[tone];
  const [active, setActive] = useState<HeatmapCell | null>(null);
  const max = useMemo(
    () => Math.max(0, ...rows.flatMap((row) => row.values)),
    [rows],
  );
  const activeRow = active ? rows[active.row] : undefined;
  const activeColumn = active ? columns[active.column] : undefined;
  const readout =
    activeRow && activeColumn && active
      ? describeCell(
          activeRow,
          activeColumn,
          activeRow.values[active.column] ?? 0,
        )
      : summary;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <table
          className="w-full border-separate border-spacing-0.5 text-xs"
          onPointerLeave={() => setActive(null)}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className={`sticky left-0 ${Z_LAYER.raised} bg-white`}
              >
                <span className="sr-only">Zeile</span>
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="h-5 min-w-8 p-0 text-left align-bottom font-normal whitespace-nowrap text-gray-500"
                >
                  <span className="sr-only">{column.label}</span>
                  {column.tick ? (
                    <span aria-hidden="true" className="tabular-nums">
                      {column.tick}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className={`sticky left-0 ${Z_LAYER.raised} bg-white pr-3 text-left align-middle font-normal whitespace-nowrap`}
                >
                  <span className="block text-sm font-medium text-gray-900">
                    {row.shortLabel ? (
                      <>
                        <span className="sm:hidden" aria-hidden="true">
                          {row.shortLabel}
                        </span>
                        <span className="max-sm:sr-only">{row.label}</span>
                      </>
                    ) : (
                      row.label
                    )}
                  </span>
                  {row.meta ? (
                    <span className="block text-xs text-gray-500 max-sm:hidden">
                      {row.meta}
                    </span>
                  ) : null}
                </th>
                {columns.map((column, columnIndex) => {
                  const value = row.values[columnIndex] ?? 0;
                  const share = shareOf(value, max);
                  const background =
                    share > 0 ? rampColor(ramp, share) : undefined;
                  const text = value > 0 ? formatValue(value) : "";
                  const marked =
                    highlight?.row === rowIndex &&
                    highlight.column === columnIndex;
                  const hovered =
                    active?.row === rowIndex && active.column === columnIndex;
                  return (
                    <td
                      key={column.key}
                      onPointerEnter={() =>
                        setActive({ row: rowIndex, column: columnIndex })
                      }
                      className={`h-9 min-w-8 rounded-md p-0 text-center align-middle font-semibold tabular-nums motion-safe:transition-shadow ${
                        background ? "" : "bg-gray-100"
                      } ${
                        hovered
                          ? "ring-2 ring-gray-900 ring-offset-1"
                          : marked
                            ? "ring-2 ring-gray-900/70"
                            : ""
                      }`}
                      style={
                        background
                          ? {
                              backgroundColor: background,
                              color: inkOn(background),
                            }
                          : undefined
                      }
                    >
                      <span aria-hidden="true">{text}</span>
                      <span className="sr-only">
                        {describeCell(row, column, value)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="min-h-5 text-sm text-gray-700" aria-hidden="true">
          {readout}
        </p>
        <div
          className="flex items-center gap-2 text-xs text-gray-500"
          aria-hidden="true"
        >
          <span className="tabular-nums">{legend.low}</span>
          <span className="flex gap-0.5">
            <span className="h-3 w-5 rounded-sm bg-gray-100" />
            {[0.12, 0.34, 0.56, 0.78, 1].map((t) => (
              <span
                key={t}
                className="h-3 w-5 rounded-sm"
                style={{ backgroundColor: rampColor(ramp, t) }}
              />
            ))}
          </span>
          <span className="tabular-nums">{legend.high}</span>
        </div>
      </div>
    </div>
  );
}
