"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { ButtonLink } from "~/components/ui/button";
import Link from "~/components/ui/navigation-link";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";

const berlinClock = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Der Weiterlink im Kopf einer Karte der Startseite: ein weißer Knopf aus
 * dem Kit, nicht ein Wort mit Pfeil. Alle Karten tragen denselben, damit die
 * Fläche ruhig bleibt; der Kartentitel gehört in den Linknamen, weil
 * „Alle ansehen" in der Vorlesereihenfolge allein nicht sagt, was man ansieht.
 */
export function HomeCardLink({
  href,
  label,
  tooltip,
  children,
}: {
  readonly href: string;
  /** Der vorgelesene Name, mit Kartentitel. */
  readonly label: string;
  /** Welche Seite der Link öffnet, als ein Satz (#6777). */
  readonly tooltip: string;
  readonly children: ReactNode;
}) {
  return (
    <ButtonLink
      href={href}
      variant="outline"
      size="compact"
      aria-label={label}
      tooltip={tooltip}
      className="shrink-0 whitespace-nowrap"
    >
      {children}
    </ButtonLink>
  );
}

/**
 * Die aktuelle Berliner Uhrzeit als „HH:MM", halbminütlich nachgezogen.
 *
 * Im Server-HTML und bei der Hydrierung bleibt die Uhr leer, damit ein
 * Minutenwechsel keinen Mismatch auslöst. Bei einem Client-Seitenwechsel
 * steht die Uhrzeit dagegen sofort für Uhr und Karten zur Verfügung.
 */
export function useBerlinClock(): string {
  return useSyncExternalStore(subscribeToClock, berlinTime, emptyClock);
}

function subscribeToClock(onChange: () => void) {
  const id = setInterval(onChange, 30_000);
  return () => clearInterval(id);
}

function berlinTime(): string {
  return berlinClock.format(Date.now());
}

function emptyClock(): string {
  return "";
}

/**
 * Die Zeilen, die JETZT noch zählen: alles, was gerade läuft oder noch kommt.
 *
 * Eine Karte auf der Startseite hat Platz für drei Zeilen. Nimmt sie stumpf
 * die ersten drei des Tages, steht dort um 16 Uhr immer noch die
 * Frühbetreuung — ein Tagesplan, der um 8 Uhr stehen bleibt. Ist der Tag
 * vorbei, bleiben die letzten Zeilen stehen, statt die Karte zu leeren:
 * „heute war das" ist eine Antwort, eine leere Karte ist keine.
 */
export function upcomingFirst<T>(
  items: readonly T[],
  endTimeOf: (item: T) => string,
  now: string,
): { readonly items: readonly T[]; readonly allPast: boolean } {
  const firstRelevant = items.findIndex((item) => endTimeOf(item) > now);
  if (firstRelevant === -1) return { items, allPast: items.length > 0 };
  if (firstRelevant === 0) return { items, allPast: false };
  return { items: items.slice(firstRelevant), allPast: false };
}

/**
 * Zwei Spalten für eine lange Liste in einer breiten Karte (`@3xl`, 48rem):
 * man liest sie wie eine Zeitung, erst links nach unten, dann rechts; die
 * feine Linie dazwischen sagt das. Die Karte braucht `@container`, die
 * Zeilen `break-inside-avoid`.
 */
export const HOME_TWO_COLUMNS =
  "@3xl:columns-2 @3xl:gap-x-6 @3xl:[column-rule:1px_solid_var(--color-gray-200)]";

/** So viele Zeilen zeigt eine Karte auf dem Handy, bevor sie den Rest zählt. */
const PHONE_MAX_ROWS = 6;

/**
 * Wie viele Zeilen eine Karte der Startseite zeigt (#2180).
 *
 * Die Karten stehen in einem Raster mit fester Zellenhöhe. Passt der Inhalt
 * nicht, darf er nicht scrollen: die letzte sichtbare Zeile wäre dann am
 * Kartenrand angeschnitten, und das liest sich, als liefe der Baustein aus
 * seiner Karte heraus. Stattdessen stehen so viele Zeilen da, wie ganz
 * hineinpassen, und darunter der Rest als eine Zeile mit Zahl und Weg.
 *
 * Auf einem Handy gibt es keine feste Zellenhöhe — dort wächst jede Karte mit
 * ihrem Inhalt. Aber auch dort bleibt die Startseite ein Einstieg: ab einer
 * Handvoll Zeilen zählt die Karte den Rest, statt zur Liste zu werden, die
 * die nächste Karte unter den Rand schiebt.
 */
export function useHomeCardRows<T>(
  items: readonly T[],
  maxRows: number,
  { preferLatest = false }: { readonly preferLatest?: boolean } = {},
): { shown: readonly T[]; hidden: number } {
  const isPhone = useMediaQuery(BELOW_SM);
  const limit = isPhone ? PHONE_MAX_ROWS : maxRows;
  if (items.length <= limit) {
    return { shown: items, hidden: 0 };
  }
  // Der Hinweis auf den Rest kostet selbst eine Zeile Platz.
  const shownCount = Math.max(limit - 1, 1);
  const shown = preferLatest
    ? items.slice(-shownCount)
    : items.slice(0, shownCount);
  return { shown, hidden: items.length - shown.length };
}

/** Die Zeile unter einer gekappten Liste: wie viel fehlt und wo es steht. */
export function HomeMoreRow({
  hidden,
  href,
  label,
  singular,
  note,
}: {
  readonly hidden: number;
  readonly href: string;
  /** Was gezählt wird, im Plural — „Einsätze", „Hinweise", „Gruppen". */
  readonly label: string;
  /** Dasselbe in der Einzahl — „Noch 1 Hinweis", nicht „Noch 1 Hinweise". */
  readonly singular?: string;
  /**
   * Was unter dem Rest nicht untergehen darf, etwa „1 fällt aus“: eine
   * Ausnahme hinter der Kappung bliebe sonst unsichtbar.
   */
  readonly note?: string;
}) {
  if (hidden <= 0) return null;
  return (
    <Link
      href={href}
      className="mt-2 block shrink-0 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
    >
      Noch {hidden} {hidden === 1 && singular ? singular : label} ansehen
      {note ? (
        <span className="font-normal text-gray-500">
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          {note}
        </span>
      ) : null}
    </Link>
  );
}
