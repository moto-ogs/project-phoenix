import {
  type AllowedDepartureModes,
  DEPARTURE_MODE_SHORT_LABELS,
  departureMatrixRows,
  hasAnyDepartureArrangement,
} from "~/lib/departure-plan";
import { StatusBadge } from "~/components/ui/status-badge";

/**
 * Read-only "Erlaubte Heimwege" display for the student Stammdaten. Mirrors the
 * editor's per-weekday layout: one row per weekday (Mo–Fr) with the allowed modes
 * as neutral badges, reusing the same labels and styling as the edit form
 * (DEPARTURE_MODE_* in departure-plan) so view and edit stay visually consistent.
 *
 * The badges wrap instead of forcing a single line, so a child with bus + pickup
 * on every weekday renders cleanly instead of overflowing the card. When the child
 * goes home alone every day the matrix collapses to a single "Geht immer alleine"
 * line rather than five identical "Zu Fuß" rows.
 */
export function AllowedDepartureModesDisplay({
  value,
  grouped = false,
}: Readonly<{
  value?: AllowedDepartureModes | null;
  /**
   * App (#8070): Aufeinanderfolgende Tage mit gleichen Heimwegen stehen in
   * einer Zeile („Mo–Fr Bus“) statt fünf gleicher Zeilen.
   */
  grouped?: boolean;
}>) {
  if (!hasAnyDepartureArrangement(value)) {
    return <span className="text-gray-900">Geht immer alleine</span>;
  }

  const rows = departureMatrixRows(value);
  const shown = grouped ? groupEqualDays(rows) : rows;
  return (
    <div className="space-y-1.5">
      {shown.map((row) => (
        <div key={row.key} className="flex items-center gap-3">
          <span
            className={
              grouped
                ? "min-w-7 shrink-0 text-xs font-semibold text-gray-500"
                : "w-7 shrink-0 text-xs font-semibold text-gray-500"
            }
          >
            {row.short}
          </span>
          <div className="flex flex-wrap gap-1">
            {row.modes.map((mode) => (
              <StatusBadge
                key={mode}
                tone="gray"
                compact
                label={DEPARTURE_MODE_SHORT_LABELS[mode]}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type MatrixRow = ReturnType<typeof departureMatrixRows>[number];

function groupEqualDays(rows: readonly MatrixRow[]): MatrixRow[] {
  const out: { first: MatrixRow; last: MatrixRow }[] = [];
  for (const row of rows) {
    const current = out.at(-1);
    if (current && current.last.modes.join() === row.modes.join()) {
      current.last = row;
    } else {
      out.push({ first: row, last: row });
    }
  }
  return out.map(({ first, last }) =>
    first === last
      ? first
      : { ...first, short: `${first.short}–${last.short}` },
  );
}
