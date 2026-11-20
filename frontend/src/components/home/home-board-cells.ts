import type { HomeBlockSpan, HomeBoardCell } from "~/lib/home-blocks";

/**
 * Was Leseansicht und Anpassen-Modus des Bretts gemeinsam brauchen: beide
 * legen jede Kachel in dieselbe Zelle, damit der Wechsel zwischen ihnen
 * nichts verschiebt.
 */

// Auch das Handy hat zwei Spalten: eine Kennzahl ist eine Zahl mit einem Wort
// und braucht keine volle Bildschirmbreite — untereinander gestellt schiebt
// sie alles Wichtige unter den Rand. Listen nehmen dort beide Spalten. Nur
// dort fließen die Kacheln; ab `sm` überschreiben die Zellvariablen die
// Spalte (siehe CELL_CLASSES).
export const SPAN_CLASS: Record<HomeBlockSpan, string> = {
  1: "col-span-1",
  2: "col-span-2",
  4: "col-span-2",
};

/**
 * Ab der zweispaltigen Ansicht bekommt jede Kachel ihre Zelle ausdrücklich —
 * und zwar ÜBER CSS, nicht über JavaScript. Die Kachel trägt beide Zellen als
 * Variablen (die des Zwei-Spalten-Rasters und die der vier Spalten der
 * Person), und der Breakpoint entscheidet, welche gilt. So stimmt schon das
 * Server-HTML bei jeder Bildschirmbreite. Vorher entschied eine Media-Query
 * aus JavaScript über die Spaltenzahl; die kennt der Server nicht und lieferte
 * immer zwei Spalten. In einem breiten Fenster standen dann alle Kacheln bis
 * zur Hydration in der linken Hälfte des Vier-Spalten-Rasters und sprangen
 * erst danach auf volle Breite.
 */
export const CELL_CLASSES =
  "sm:[grid-column:var(--cell-col-2)] sm:[grid-row:var(--cell-row-2)] xl:[grid-column:var(--cell-col-4)] xl:[grid-row:var(--cell-row-4)]";

/** Spalten des schmalen Rasters (Tablet und schmaler Desktop). */
export const NARROW_BOARD_COLUMNS = 2;

// Jede Zelle bekommt ihren Platz ausdrücklich zugewiesen (Spalte und Zeile
// der Person); das Raster verteilt nichts selbst und füllt keine Lücken. Nur
// auf dem Handy fließen die Kacheln in Lesereihenfolge, dort gibt es keine
// Zelle, neben der etwas stehen müsste. `relative`, damit die Zellen ihre
// Lage relativ zum Raster kennen.
export const BOARD_GRID_CLASSES =
  "relative grid grid-cols-2 gap-4 sm:auto-rows-[7rem] xl:grid-cols-4";

/**
 * Rasterzeile der Leseansicht ab `sm`: 7rem Karte plus 1rem Abstand. Der
 * Abstand steckt als Innenabstand in der Zelle statt als `row-gap` im
 * Raster, damit eine Zeile, die nur eine leere Karte belegt, ganz
 * verschwinden kann und keinen doppelten Abstand hinterlässt.
 */
const READ_ROW = "8rem";

/**
 * Das Raster der Leseansicht. Dieselben Zellen wie beim Anpassen, aber die
 * Zeilen sind `auto`: jede Karte mit Inhalt bringt ihre feste Höhe selbst mit
 * (`READ_CELL_CLASSES`) und hält die Zeilen damit auf dem 7rem-Raster. Nur
 * eine Karte, die nichts zu zeigen hat, gibt ihre Höhe frei. Welche Zeilen
 * die Person frei gelassen hat, sagen `--board-rows-*` (`boardRowVariables`).
 */
export const READ_GRID_CLASSES =
  "relative grid grid-cols-2 gap-4 sm:-mb-4 sm:auto-rows-auto sm:gap-y-0 sm:[grid-template-rows:var(--board-rows-2,none)] xl:grid-cols-4 xl:[grid-template-rows:var(--board-rows-4,none)]";

/**
 * Höhe einer Zelle der Leseansicht ab `sm`: so viele Rasterzeilen, wie der
 * Baustein belegt. Zeigt die Karte nur ihren Leertext (`HomeCardEmpty`),
 * gilt die Höhe nicht: die Zelle ist dann so hoch wie ihr Text, oder so hoch
 * wie die Nachbarn, die ihre Zeilen offen halten. Ebenso wächst eine Karte,
 * die ihren Inhalt ganz zeigen muss (`data-home-card-fit`, „Heute anders“). Ein Browser ohne `:has()`
 * behält die feste Höhe.
 */
export const READ_CELL_CLASSES =
  "sm:h-[calc(var(--cell-rows)*8rem)] sm:pb-4 sm:has-[[data-home-card-empty]]:h-auto sm:has-[[data-home-card-fit]]:h-auto";

/** Die Höhe eines Bausteins in Rasterzeilen, wie READ_CELL_CLASSES sie liest. */
export function cellRowsVariable(rows: number): Record<string, string> {
  return { "--cell-rows": String(rows) };
}

/**
 * Die Zeilen eines Rasters der Leseansicht als `grid-template-rows`.
 *
 * Eine Zeile, in der ein Baustein liegt, ist `auto`. Eine Zeile, die die
 * Person frei gelassen hat, behält ihre volle Höhe: Lücken sind erlaubt und
 * bleiben, wie sie gebaut wurden. Ohne freie Zeile braucht es keine Vorlage.
 */
export function boardRowVariables(
  cells: Iterable<HomeBoardCell>,
  columns: number,
): Record<string, string> {
  const occupied = new Set<number>();
  for (const cell of cells) {
    for (let offset = 0; offset < cell.rowSpan; offset++) {
      occupied.add(cell.rowStart + offset);
    }
  }
  const rowCount = Math.max(0, ...occupied);
  if (occupied.size === rowCount) return {};
  const rows = Array.from({ length: rowCount }, (_, index) =>
    occupied.has(index + 1) ? "auto" : READ_ROW,
  );
  return { [`--board-rows-${columns}`]: rows.join(" ") };
}

/** Die Zelle eines Rasters als die Variablen, die CELL_CLASSES liest. */
export function cellVariables(
  cell: HomeBoardCell | null,
  columns: number,
): Record<string, string> {
  if (!cell) return {};
  return {
    [`--cell-col-${columns}`]: `${cell.columnStart} / span ${cell.columnSpan}`,
    [`--cell-row-${columns}`]: `${cell.rowStart} / span ${cell.rowSpan}`,
  };
}
