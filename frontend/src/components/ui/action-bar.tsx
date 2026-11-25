"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

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
 * Platz, den die Leiste über der Pill belegt (Höhe plus Abstand), als
 * CSS-Variable am Dokument. Seiteninhalt (`PortalShell`), Listen der
 * `SplitView` und Toasts halten ihn frei; ohne Leiste fehlt sie (`0px`).
 */
export const ACTION_BAR_SPACE_VAR = "--app-action-bar-space";

/**
 * Die Hauptaktion einer Aufgabe in Daumennähe (#8070): schwebt in der App
 * über der Pill-Navigation, mit Safe Area und eigenem Abstand. Links darf
 * ein kurzer Status stehen („3 Kinder gewählt“) oder eine Nebenaktion. Die
 * Leiste meldet ihre Höhe (`--app-action-bar-space`); die Seite hält sie
 * unten frei, damit nichts darunter verschwindet.
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
  const barRef = useRef<HTMLDivElement>(null);
  useActionBarSpace(barRef, !resolved || isApp);
  if (resolved && !isApp) return null;
  return (
    <>
      {/* Deckende Zone von der Leiste bis zum unteren Rand: Zwischen Leiste
          und Pill scheint keine Liste durch. Oben läuft sie weich aus. */}
      <div
        aria-hidden="true"
        data-action-bar-backdrop=""
        className={`moto-app-backdrop app:block pointer-events-none fixed inset-x-0 bottom-0 hidden ${Z_LAYER.nav} ${FIXED_LAYER_SHIFT} [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem)]`}
        style={{
          height: `calc(${ABOVE_PILL} + var(${ACTION_BAR_SPACE_VAR}, 4.5rem) + 0.5rem)`,
        }}
      />
      <div
        ref={barRef}
        data-action-bar=""
        className={cn(
          `app:flex fixed inset-x-3 hidden ${Z_LAYER.nav} ${FIXED_LAYER_SHIFT}`,
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

/** Meldet die Höhe der Leiste als `--app-action-bar-space` am Dokument. */
function useActionBarSpace(
  barRef: RefObject<HTMLDivElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const bar = barRef.current;
    if (!active || bar === null) return undefined;
    const root = document.documentElement;
    const update = () => {
      const height = bar.offsetHeight;
      if (height > 0) {
        root.style.setProperty(ACTION_BAR_SPACE_VAR, `${height + 8}px`);
      } else {
        root.style.removeProperty(ACTION_BAR_SPACE_VAR);
      }
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(ACTION_BAR_SPACE_VAR);
    };
  }, [barRef, active]);
}
