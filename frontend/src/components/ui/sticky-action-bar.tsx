import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { STICKY_ABOVE_BOTTOM_NAV, Z_LAYER } from "./overlay-styles";

/**
 * Die Leiste mit den Aktionen einer langen Seite (Import, Speiseplan). Sie
 * klebt am unteren Rand, solange die Seite scrollt. Seiten, die schon vor der
 * Umstellung Platz dafür reservierten, setzen `reserveSpace`.
 *
 * `summary` steht links und sagt, worauf sich die Aktionen beziehen; die
 * Aktionen stehen dann rechts in einer Zeile. Ohne `summary` füllen die
 * Aktionen die Leiste, am Telefon untereinander.
 */
export function StickyActionBar({
  summary,
  reserveSpace = false,
  children,
}: Readonly<{
  summary?: ReactNode;
  /** Platz für die Leiste nur erhalten, wenn die Seite ihn vorher hatte. */
  reserveSpace?: boolean;
  children: ReactNode;
}>) {
  return (
    <>
      {reserveSpace && <div aria-hidden="true" className="h-20" />}
      <div
        className={cn(
          STICKY_ABOVE_BOTTOM_NAV,
          `${Z_LAYER.sticky} rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-lg`,
          summary
            ? "flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
            : "flex flex-col gap-2 sm:flex-row sm:gap-3",
        )}
      >
        {summary ? (
          <>
            {/* Mindestens 12rem breit: wird es enger, rücken die Aktionen
                in eine eigene Zeile, statt dass die Zusammenfassung unter
                „Abbrechen“ läuft. */}
            <span className="min-w-48 flex-1 text-sm font-medium text-gray-700">
              {summary}
            </span>
            <div className="ml-auto flex shrink-0 gap-2">{children}</div>
          </>
        ) : (
          children
        )}
      </div>
    </>
  );
}
