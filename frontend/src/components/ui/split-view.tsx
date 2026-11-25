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
 * Liste neben Detail (#8070): unter `split:` (iPad quer) steht die Liste in
 * einem Drittel links mit eigenem Scroll, das Detail in zwei Dritteln rechts.
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
  const listRef = useRef<HTMLDivElement>(null);
  const restTop = useRestTop(listRef, isSplit);
  if (!isSplit) return <>{list}</>;
  return (
    <div
      data-split-view=""
      className={cn("grid grid-cols-[1fr_2fr] items-start gap-4", className)}
    >
      {/* Die Liste endet über Pill und ActionBar, schon bevor die Seite
          scrollt (Höhe ab ihrer Ruhelage). */}
      <div
        ref={listRef}
        data-split-list=""
        className="sticky overflow-y-auto overscroll-contain rounded-2xl"
        style={{
          top: "var(--app-sticky-offset, 1rem)",
          maxHeight: `calc(100dvh - ${restTop === null ? "var(--app-sticky-offset, 1rem)" : `${restTop}px`} - 7rem - var(--app-action-bar-space, 0px))`,
        }}
      >
        {/* Im eigenen Scroll kleben Gruppenköpfe oben an der Liste. */}
        <div style={{ "--app-sticky-offset": "0px" } as CSSProperties}>
          {list}
        </div>
      </div>
      <div data-split-detail="" className="min-w-0">
        {detail ?? (
          <div className="moto-content-surface flex min-h-64 items-center justify-center rounded-2xl border p-8 text-center text-sm text-gray-500">
            {empty}
          </div>
        )}
      </div>
    </div>
  );
}

/** Abstand der Liste vom Seitenanfang, solange die Seite oben steht. */
function useRestTop(
  ref: RefObject<HTMLDivElement | null>,
  active: boolean,
): number | null {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || node === null) return undefined;
    const update = () => {
      // Kleben greift erst darunter: Ruhelage im Dokument, höchstens das
      // Fenster hoch.
      const rest = node.getBoundingClientRect().top + window.scrollY;
      setTop(Math.round(Math.min(rest, window.innerHeight / 2)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
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
