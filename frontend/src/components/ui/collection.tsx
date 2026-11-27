"use client";

import { ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEventHandler,
  type RefObject,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { Button } from "./button";
import NavigationLink from "./navigation-link";
import { Z_LAYER } from "./overlay-styles";

/**
 * Liste in EINER Karte (#8070): Datensätze als Zeilen mit Trennlinien statt
 * als gestapelte Karten. Optional gruppiert, die Gruppenköpfe kleben beim
 * Scrollen unter der Leiste des Seitenkopfs (`--app-sticky-offset`).
 *
 * ```tsx
 * <Collection label="Kinder">
 *   <CollectionGroup title="Fehlt noch" count={3}>
 *     <CollectionRow href="/students/7" title="Mia Kaya" subtitle="Klasse 2a"
 *       leading={<Avatar name="Mia Kaya" size="sm" decorative />}
 *       meta="14:00" action={<Button …>Da</Button>} />
 *   </CollectionGroup>
 * </Collection>
 * ```
 *
 * Gedacht für die App. Eine Seite, deren Desktop eine Tabelle oder Kacheln
 * zeigt, behält diesen Code und schaltet mit `DeviceSwitch` um; ohne das
 * rendert die Collection auf dem Desktop dieselbe Liste.
 */
export function Collection({
  label,
  children,
  className,
}: Readonly<{
  /** Name der Liste für Vorleseprogramme. */
  label: string;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <section
      aria-label={label}
      data-collection=""
      className={cn(
        "moto-content-surface overflow-clip rounded-2xl border",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Auf- und Zuklappen einer Gruppe; den Zustand hält der Aufrufer. */
export interface CollectionGroupCollapsible {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /**
   * Zähler, der zugeklappt vor dem Pfeil steht, wie an einer zugeklappten
   * Gruppe der Seitenleiste: was in den versteckten Zeilen neu oder offen
   * ist. Nur Anzeige, kein eigenes Ziel; der Pfeil bleibt in der Flucht.
   */
  readonly collapsedBadge?: ReactNode;
}

/** Eine Gruppe mit klebendem Kopf („Fehlt noch“, „Da“ …). */
export function CollectionGroup({
  title,
  count,
  meta,
  sticky = false,
  collapsible,
  children,
}: Readonly<{
  title: ReactNode;
  /**
   * Kopf klebt beim Scrollen. Standard aus: Klebende Köpfe unter der
   * schwebenden Kopfkarte schnitten die Zeilen hart ab; die Gruppen laufen
   * wie der übrige Inhalt unter der Kopfkarte durch.
   */
  sticky?: boolean;
  /** Anzahl der Einträge, steht neben dem Namen. */
  count?: number;
  /** Rechts im Kopf, etwa eine Aktion für die ganze Gruppe. */
  meta?: ReactNode;
  /**
   * Der Kopf klappt die Zeilen auf und zu, wie eine Gruppe der Seitenleiste:
   * der ganze Streifen ist der Knopf, der Pfeil rechts zeigt den Zustand.
   * Zugeklappt fehlen die Zeilen im Baum. Ohne bleibt die Gruppe, wie sie war.
   */
  collapsible?: CollectionGroupCollapsible;
  children: ReactNode;
}>) {
  const headRef = useRef<HTMLDivElement>(null);
  const stuck = useHeadStuck(headRef, sticky);
  const rowsId = useId();
  const expanded = collapsible?.expanded ?? true;
  const heading = (
    <>
      {title}
      {count === undefined ? null : (
        <span className="ml-1.5 font-normal text-gray-500 tabular-nums">
          {count}
        </span>
      )}
    </>
  );
  return (
    <div
      role="group"
      data-collection-group=""
      className="app:overflow-clip border-gray-100 [&+&]:border-t"
    >
      <div
        ref={headRef}
        className={cn(
          sticky ? `sticky ${Z_LAYER.sticky}` : "relative",
          "app:bg-gray-50 flex min-h-9 items-center justify-between gap-3 border-gray-100 bg-gray-50/95 px-4 py-1.5",
          // Zugeklappt trennt die Linie der nächsten Gruppe; eine eigene
          // stünde doppelt.
          expanded && "border-b",
          // Ein Klapp-Kopf ist ein Ziel für den Finger: 44 px, damit die
          // Trefferfläche des Knopfs ganz im Streifen liegt und weder von der
          // Kartenkante noch von der ersten Zeile beschnitten wird.
          collapsible && "min-h-11",
          // App: Zeilen, die unter dem klebenden Kopf verschwinden, laufen
          // weich aus statt hart angeschnitten stehen zu bleiben.
          stuck &&
            "app:after:pointer-events-none app:after:absolute app:after:inset-x-0 app:after:top-full app:after:h-8 app:after:bg-linear-to-b app:after:from-white app:after:to-white/0 app:after:content-['']",
        )}
        style={sticky ? { top: "var(--app-sticky-offset, 0px)" } : undefined}
      >
        {collapsible ? (
          <h3 className="flex min-w-0 flex-1">
            {/* Der Knopf reicht über das Polster des Kopfes: ganzer Streifen
                als Trefferfläche, ohne dass der Kopf höher wird. */}
            <Button
              type="button"
              variant="ghost"
              size="compact"
              className="-mx-2.5 -my-1.5 w-[calc(100%+1.25rem)] min-w-0 justify-start"
              aria-expanded={collapsible.expanded}
              aria-controls={collapsible.expanded ? rowsId : undefined}
              noTooltip="Der Gruppenname klappt nur ihre Zeilen auf und zu; aria-expanded nennt den Zustand."
              onClick={collapsible.onToggle}
            >
              {/* Der Knopf bringt seine eigene Schrift mit; der Name
                  behält die der übrigen Gruppenköpfe. */}
              <span className="mr-auto min-w-0 truncate text-left text-sm font-semibold text-gray-700">
                {heading}
              </span>
              {!collapsible.expanded && collapsible.collapsedBadge ? (
                <span className="flex shrink-0 items-center">
                  {collapsible.collapsedBadge}
                </span>
              ) : null}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "h-4 w-4 shrink-0 text-gray-500 motion-safe:transition-transform motion-safe:duration-200",
                  collapsible.expanded && "rotate-180",
                )}
              />
            </Button>
          </h3>
        ) : (
          <h3 className="tablet:text-[0.9375rem] text-sm font-semibold text-gray-700">
            {heading}
          </h3>
        )}
        {meta ? (
          <div className="shrink-0 text-sm text-gray-500">{meta}</div>
        ) : null}
      </div>
      {expanded ? (
        <ul
          id={collapsible ? rowsId : undefined}
          className="divide-y divide-gray-100"
        >
          {children}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Ob der klebende Kopf gerade klebt (unter ihm laufen Zeilen weg). Prüft bei
 * jedem Scrollen, auch in Spalten mit eigenem Scroll (`SplitView`).
 */
function useHeadStuck(
  ref: RefObject<HTMLDivElement | null>,
  active: boolean,
): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const head = ref.current;
    const group = head?.parentElement;
    if (!active || !head || !group) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset =
        head.getBoundingClientRect().top - group.getBoundingClientRect().top;
      setStuck(offset > 1);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    document.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, { capture: true });
    };
  }, [ref, active]);
  return stuck;
}

/** Zeilen ohne Gruppe. */
export function CollectionList({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <ul className="divide-y divide-gray-100">{children}</ul>;
}

type RowTarget =
  | { readonly href: string; readonly onClick?: never }
  | {
      readonly href?: never;
      readonly onClick?: MouseEventHandler<HTMLButtonElement>;
    };

export type CollectionRowProps = RowTarget & {
  /** Avatar oder Statuspunkt. */
  readonly leading?: ReactNode;
  readonly title: ReactNode;
  /** Eine Unterzeile, wird gekürzt. */
  readonly subtitle?: ReactNode;
  /** Rechts: Zeit oder Status. */
  readonly meta?: ReactNode;
  /** Höchstens EINE Hauptaktion; sie liegt über der tippbaren Zeile. */
  readonly action?: ReactNode;
  /** Hebt die Zeile als gewählt hervor (Liste neben Detail). */
  readonly selected?: boolean;
  /** Zugänglicher Name des Ziels, wenn der Titel allein nicht reicht. */
  readonly "aria-label"?: string;
  /**
   * Titel und Unterzeile brechen um statt gekürzt zu werden: für Sätze
   * („Mia geht heute um 13:30 Uhr.“), nicht für Namen in langen Listen.
   */
  readonly wrap?: boolean;
};

/**
 * Eine Zeile: sichtbar 56–64 px, ganze Zeile tippbar (Link oder Knopf über
 * die volle Fläche), die Hauptaktion bleibt eigenes Ziel darüber. Sichtbare
 * Rückmeldung beim Antippen, Fokusring um die Zeile.
 */
export function CollectionRow({
  leading,
  title,
  subtitle,
  meta,
  action,
  selected = false,
  href,
  onClick,
  "aria-label": ariaLabel,
  wrap = false,
}: CollectionRowProps) {
  // Das Ziel spannt sich über die ganze Zeile (Pseudo-Element), damit die
  // Hauptaktion kein Kind des Links ist.
  const stretch =
    "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none";
  const titleNode = (
    <span
      className={cn(
        "tablet:text-base tablet:leading-6 block text-[0.9375rem] leading-5 font-medium text-gray-900",
        wrap ? "break-words" : "truncate",
      )}
    >
      {title}
    </span>
  );
  let target: ReactNode = titleNode;
  if (href) {
    target = (
      <NavigationLink
        href={href}
        data-row-target=""
        aria-label={ariaLabel}
        aria-current={selected ? "page" : undefined}
        className={stretch}
      >
        {titleNode}
      </NavigationLink>
    );
  } else if (onClick) {
    target = (
      // oxlint-disable-next-line ui-kit/no-hand-rolled-button -- Ziel einer Listenzeile, keine Aktion im Sinn des Knopf-Kits
      <button
        type="button"
        data-row-target=""
        aria-label={ariaLabel}
        aria-pressed={selected || undefined}
        onClick={onClick}
        className={cn("block w-full min-w-0 text-left", stretch)}
      >
        {titleNode}
      </button>
    );
  }
  const interactive = Boolean(href ?? onClick);
  return (
    <li
      data-collection-row=""
      data-selected={selected || undefined}
      className={cn(
        "relative flex min-h-14 items-center gap-3 px-4 py-2 [-webkit-tap-highlight-color:transparent]",
        interactive &&
          "desk:has-[[data-row-target]:hover]:bg-gray-50 transition-colors has-[[data-row-target]:active]:bg-gray-100 has-[[data-row-target]:focus-visible]:ring-2 has-[[data-row-target]:focus-visible]:ring-gray-600 has-[[data-row-target]:focus-visible]:ring-inset",
        selected && "bg-moto-green-soft/60",
      )}
    >
      {leading ? (
        <span className="flex shrink-0 items-center">{leading}</span>
      ) : null}
      <span className="min-w-0 flex-1">
        {target}
        {subtitle ? (
          <span
            className={cn(
              "tablet:text-[0.9375rem] mt-0.5 block text-sm leading-5 text-gray-500",
              wrap ? "break-words whitespace-pre-line" : "truncate",
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
      {meta ? (
        <span className="tablet:text-[0.9375rem] shrink-0 text-right text-sm text-gray-600 tabular-nums">
          {meta}
        </span>
      ) : null}
      {action ? (
        // Über dem gestreckten Ziel, damit die Aktion ihr eigenes Ziel bleibt.
        <span className={`relative ${Z_LAYER.raised} shrink-0`}>{action}</span>
      ) : null}
    </li>
  );
}
