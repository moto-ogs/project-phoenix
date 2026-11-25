"use client";

import type { MouseEventHandler, ReactNode } from "react";

import { cn } from "~/lib/utils";
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

/** Eine Gruppe mit klebendem Kopf („Fehlt noch“, „Da“ …). */
export function CollectionGroup({
  title,
  count,
  meta,
  children,
}: Readonly<{
  title: ReactNode;
  /** Anzahl der Einträge, steht neben dem Namen. */
  count?: number;
  /** Rechts im Kopf, etwa eine Aktion für die ganze Gruppe. */
  meta?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <div
      role="group"
      data-collection-group=""
      className="border-gray-100 [&+&]:border-t"
    >
      <div
        className={`sticky ${Z_LAYER.sticky} app:bg-gray-50 flex min-h-9 items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/95 px-4 py-1.5`}
        style={{ top: "var(--app-sticky-offset, 0px)" }}
      >
        <h3 className="tablet:text-[0.9375rem] text-sm font-semibold text-gray-700">
          {title}
          {count === undefined ? null : (
            <span className="ml-1.5 font-normal text-gray-500 tabular-nums">
              {count}
            </span>
          )}
        </h3>
        {meta ? (
          <div className="shrink-0 text-sm text-gray-500">{meta}</div>
        ) : null}
      </div>
      <ul className="divide-y divide-gray-100">{children}</ul>
    </div>
  );
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
