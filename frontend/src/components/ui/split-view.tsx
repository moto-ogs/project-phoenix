"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { useDeviceContext } from "~/lib/device-context";
import { cn } from "~/lib/utils";

/**
 * Liste neben Detail (#8070): unter `split:` (iPad quer) stehen Liste (⅓)
 * und Detail (⅔) als zwei eigenständige Spalten. Die Seite selbst scrollt
 * dann nicht mehr: Beide Spalten füllen den Platz zwischen ihrer Ruhelage
 * unter der Kopfkarte und der Pill und scrollen je für sich. So bleibt die
 * Kopfkarte stehen, und nichts rutscht unter sie. Eine `ActionBar` steht in
 * der Spalte, zu der sie gehört (`column`); diese Spalte endet über ihr.
 * Darunter (Telefon, iPad hoch, Desktop) zeigt der Baustein nur die Liste;
 * die Zeile führt dort wie heute auf die Detailseite.
 *
 * Die Auswahl steht in der Adresse (`?kind=<id>` über `useSplitSelection`),
 * damit Zurück, Neuladen und Teilen sie behalten.
 *
 * ```tsx
 * const { selected, select } = useSplitSelection("kind", { defaultId: firstId });
 * <SplitView list={<Collection …/>} detail={selected ? <KindDetail id={selected} /> : null}
 *   empty="Wähle links ein Kind, um seine Angaben zu sehen." />
 * ```
 */
export function SplitView({
  list,
  detail,
  empty,
  className,
}: Readonly<{
  list: ReactNode;
  /** Das gewählte Detail; `null`, solange nichts gewählt ist. */
  detail: ReactNode | null;
  /** Ruhiger Leerzustand rechts, solange nichts gewählt ist. */
  empty: ReactNode;
  className?: string;
}>) {
  const { isSplit } = useDeviceContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const restTop = useRestTop(rootRef, isSplit);
  useSplitPageLock(isSplit);
  useMoreBelow(rootRef, isSplit);
  if (!isSplit) return <>{list}</>;
  return (
    <div
      ref={rootRef}
      data-split-view=""
      className={cn("grid grid-cols-[1fr_2fr] items-start gap-4", className)}
      style={{
        // Von der Ruhelage bis über die Pill (ihre Höhe samt Abstand).
        height: `max(20rem, calc(100dvh - ${restTop ?? 0}px - ${SPLIT_BOTTOM}))`,
      }}
    >
      <div
        data-split-list=""
        data-action-bar-column="list"
        className={SPLIT_COLUMN}
      >
        {/* Im eigenen Scroll kleben Gruppenköpfe oben an der Spalte. */}
        <div style={{ "--app-sticky-offset": "0px" } as CSSProperties}>
          {list}
        </div>
      </div>
      <div
        data-split-detail=""
        data-action-bar-column="detail"
        className={cn(SPLIT_COLUMN, "min-w-0")}
      >
        {detail ?? (
          <div className="moto-content-surface flex min-h-64 items-center justify-center rounded-2xl border p-8 text-center text-sm text-gray-500">
            {empty}
          </div>
        )}
      </div>
    </div>
  );
}

/** Abstand der Spalten vom unteren Rand: Pill, Safe Area und Luft. */
const SPLIT_BOTTOM = "(6.5rem + env(safe-area-inset-bottom))";

/**
 * Eine Spalte mit eigenem Scroll. Höchstens so hoch wie der Split; die
 * Spalte der `ActionBar` endet über ihr (Regel in `globals.css`).
 */
const SPLIT_COLUMN =
  "max-h-full min-h-0 overflow-y-auto overscroll-contain rounded-2xl [scrollbar-width:none]";

/**
 * Solange der Split steht, scrollt die Seite nicht: Sie steht oben, damit
 * die Kopfkarte ganz sichtbar bleibt; gescrollt wird in den Spalten.
 */
function useSplitPageLock(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return undefined;
    const root = document.documentElement;
    window.scrollTo(0, 0);
    root.setAttribute("data-split-page", "");
    // `scrollIntoView` in einer Spalte schiebt sonst auch die Seite.
    const keepTop = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", keepTop, { passive: true });
    return () => {
      window.removeEventListener("scroll", keepTop);
      root.removeAttribute("data-split-page");
    };
  }, [active]);
}

/**
 * Markiert eine Spalte mit `data-more-below`, solange unter ihr noch Inhalt
 * folgt; sie läuft dann unten weich aus statt hart zu enden (`globals.css`).
 * Eine unten klebende Aktion (`data-split-list-action`) bleibt unverblasst.
 */
function useMoreBelow(ref: RefObject<HTMLDivElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!active || root === null) return undefined;
    const columns = [...root.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const update = () => {
      for (const column of columns) {
        const more =
          column.scrollHeight - column.scrollTop - column.clientHeight > 2;
        column.toggleAttribute("data-more-below", more);
        // Eine unten klebende Aktion der Spalte bleibt außerhalb der
        // Ausblendung: Sie endet direkt über ihr.
        const footer = column.querySelector<HTMLElement>(
          "[data-split-list-action]",
        );
        if (footer) {
          column.style.setProperty(
            "--split-fade-inset",
            `${footer.offsetHeight}px`,
          );
        } else {
          column.style.removeProperty("--split-fade-inset");
        }
      }
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    for (const column of columns) {
      column.addEventListener("scroll", update, { passive: true });
      observer?.observe(column);
      if (column.firstElementChild) observer?.observe(column.firstElementChild);
    }
    return () => {
      observer?.disconnect();
      for (const column of columns) {
        column.removeEventListener("scroll", update);
      }
    };
  }, [ref, active]);
}

/** Abstand des Splits vom Seitenanfang, solange die Seite oben steht. */
function useRestTop(
  ref: RefObject<HTMLDivElement | null>,
  active: boolean,
): number | null {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || node === null) return undefined;
    const update = () => {
      const rest = node.getBoundingClientRect().top + window.scrollY;
      setTop(Math.round(Math.min(rest, window.innerHeight / 2)));
    };
    update();
    // Kopf und Hinweise darüber ändern ihre Höhe (Chips laden nach).
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(document.body);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref, active]);
  return top;
}

/**
 * Die Auswahl einer `SplitView` in der Adresse. `select(id)` ersetzt den
 * Parameter (kein neuer Verlaufsschritt je Tipp), `select(null)` entfernt ihn.
 * `rowProps(id, href)` liefert einer `CollectionRow` das passende Ziel: im
 * Split die Auswahl, sonst den Link auf die Detailseite.
 *
 * `defaultId` wählt im Split vor, solange die Adresse nichts nennt (etwa die
 * erste Zeile), damit die Detailspalte nie leer steht.
 */
export function useSplitSelection(
  param = "kind",
  options: Readonly<{ defaultId?: string | null }> = {},
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSplit } = useDeviceContext();
  const selected = searchParams.get(param) ?? options.defaultId ?? null;

  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (id === null) next.delete(param);
      else next.set(param, id);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, searchParams, param],
  );

  const rowProps = useCallback(
    (id: string, href: string) =>
      isSplit
        ? {
            onClick: () => select(id),
            selected: selected === id,
          }
        : { href },
    [isSplit, select, selected],
  );

  return { selected: isSplit ? selected : null, select, rowProps };
}
