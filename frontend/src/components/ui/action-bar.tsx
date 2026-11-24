"use client";

import type { ReactNode } from "react";

import { useDeviceContext } from "~/lib/device-context";
import { cn } from "~/lib/utils";
import { FIXED_LAYER_SHIFT } from "./hooks/useFixedLayersFollowViewport";
import { Z_LAYER } from "./overlay-styles";

/**
 * Abstand der Leiste vom unteren Rand: über der Pill (ihre Höhe samt Rand)
 * und der Safe Area. Die Pill bleibt ganz sichtbar und bedienbar.
 */
const ABOVE_PILL = "calc(env(safe-area-inset-bottom) + 5.75rem)";

/**
 * Die Hauptaktion einer Aufgabe in Daumennähe (#8070): schwebt in der App
 * über der Pill-Navigation, mit Safe Area und eigenem Abstand. Links darf
 * ein kurzer Status stehen („3 Kinder gewählt“) oder eine Nebenaktion. Die
 * Seite bekommt unten so viel Polster, dass nichts darunter verschwindet.
 *
 * Nur App: Auf dem Desktop rendert die Leiste nichts; dort bleibt die
 * Aktion, wo die Seite sie heute hat (Kopf, `StickyActionBar`).
 *
 * ```tsx
 * <ActionBar status="3 Kinder gewählt" secondary={<Button variant="outline" …>Abbrechen</Button>}>
 *   <Button variant="primary" className="flex-1" …>Speichern</Button>
 * </ActionBar>
 * ```
 */
export function ActionBar({
  children,
  secondary,
  status,
}: Readonly<{
  /** Die Hauptaktion (ein Kit-Knopf). */
  children: ReactNode;
  /** Eine Nebenaktion links neben der Hauptaktion. */
  secondary?: ReactNode;
  /** Kurzer Status links, statt oder vor der Nebenaktion. */
  status?: ReactNode;
}>) {
  const { resolved, isApp } = useDeviceContext();
  if (resolved && !isApp) return null;
  return (
    <>
      {/* Polster am Seitenende: Höhe der Leiste plus Abstand. */}
      <div aria-hidden="true" className="app:block hidden h-20" />
      <div
        data-action-bar=""
        className={cn(
          `app:flex fixed inset-x-3 hidden ${Z_LAYER.sticky} ${FIXED_LAYER_SHIFT}`,
          "tablet:mx-auto tablet:max-w-[35rem] moto-content-surface items-center gap-2 rounded-2xl border p-2",
        )}
        style={{ bottom: ABOVE_PILL }}
      >
        {status ? (
          <span
            role="status"
            className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-gray-700"
          >
            {status}
          </span>
        ) : null}
        {secondary ? <div className="flex shrink-0">{secondary}</div> : null}
        <div
          className={cn(
            "flex min-w-0 gap-2 [&>*]:flex-1",
            status ? "shrink-0" : "flex-1",
          )}
        >
          {children}
        </div>
      </div>
    </>
  );
}
