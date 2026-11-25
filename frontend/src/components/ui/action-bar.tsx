"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

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
const ACTION_BAR_SPACE_VAR = "--app-action-bar-space";

/**
 * Die Hauptaktion einer Aufgabe in Daumennähe (#8070): schwebt in der App
 * über der Pill-Navigation, mit Safe Area und eigenem Abstand. Links darf
 * ein kurzer Status stehen („3 Kinder gewählt“) oder eine Nebenaktion. Die
 * Leiste meldet ihre Höhe (`--app-action-bar-space`); die Seite hält sie
 * unten frei, damit nichts darunter verschwindet.
 *
 * iPad quer (`SplitView`): Die Leiste steht in der Spalte, zu der ihre
 * Aufgabe gehört (`column`, Standard die Liste), nicht mittig unter beiden;
 * diese Spalte endet über ihr. Seiten ohne `SplitView` können eine eigene
 * Spalte mit `data-action-bar-column="list|detail"` markieren.
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
  column = "list",
}: Readonly<{
  /** Die Hauptaktion (ein Kit-Knopf). */
  children: ReactNode;
  /** Eine Nebenaktion links neben der Hauptaktion. */
  secondary?: ReactNode;
  /** Kurzer Status links, statt oder vor der Nebenaktion. */
  status?: ReactNode;
  /**
   * iPad quer: die Spalte, zu der die Aufgabe gehört (`list` etwa „Kinder
   * an- und abmelden“, `detail` etwa „Abmelden“ für das gewählte Kind).
   */
  column?: "list" | "detail";
}>) {
  const { resolved, isApp, isSplit } = useDeviceContext();
  const barRef = useRef<HTMLDivElement>(null);
  useActionBarSpace(barRef, !resolved || isApp);
  const anchor = useColumnAnchor(column, isSplit);
  if (resolved && !isApp) return null;
  return (
    <div
      ref={barRef}
      data-action-bar=""
      className={cn(
        `app:flex fixed hidden ${Z_LAYER.nav} ${FIXED_LAYER_SHIFT}`,
        !anchor && "tablet:mx-auto tablet:max-w-[42.5rem] inset-x-3",
        "moto-content-surface items-center gap-2 rounded-2xl border p-2",
      )}
      style={
        anchor
          ? { bottom: ABOVE_PILL, left: anchor.left, width: anchor.width }
          : { bottom: ABOVE_PILL }
      }
    >
      {status ? (
        <span
          role="status"
          className="tablet:text-base min-w-0 flex-1 truncate px-2 text-sm font-medium text-gray-700"
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

/**
 * Lage der Spalte, in der die Leiste steht (iPad quer). `null`, solange es
 * keine solche Spalte gibt: Dann steht die Leiste mittig, und jede Spalte
 * endet über ihr. Die Zuordnung steht als `data-action-bar-column` am
 * Dokument; danach richten sich die Spaltenhöhen der `SplitView`.
 */
function useColumnAnchor(
  column: "list" | "detail",
  active: boolean,
): { left: number; width: number } | null {
  const [anchor, setAnchor] = useState<{ left: number; width: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!active) {
      setAnchor(null);
      return undefined;
    }
    const root = document.documentElement;
    let target: Element | null = null;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => update());
    function update() {
      const found = document.body.querySelector(
        `[data-action-bar-column="${column}"]`,
      );
      if (found !== target) {
        if (target) observer?.unobserve(target);
        target = found;
        if (target) observer?.observe(target);
      }
      root.setAttribute("data-action-bar-column", target ? column : "all");
      if (target === null) {
        setAnchor(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      const left = Math.round(rect.left);
      const width = Math.round(rect.width);
      setAnchor((prev) =>
        prev?.left === left && prev.width === width ? prev : { left, width },
      );
    }
    update();
    // Die Spalte erscheint oft erst nach dem Laden der Daten.
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            if (target === null || !target.isConnected) update();
          });
    mutations?.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", update);
      root.removeAttribute("data-action-bar-column");
    };
  }, [column, active]);
  return anchor;
}
