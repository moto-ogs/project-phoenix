"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Verfolgt eine CSS-Media-Query im Client.
 *
 * Gedacht für die Fälle, in denen ein Breakpoint mehr entscheidet als
 * Sichtbarkeit — wenn also zwei Darstellungen NICHT beide ins Dokument gehören
 * und per `hidden`/`lg:block` weggeblendet werden dürfen. Beide zu rendern
 * verdoppelt Beschriftungen, IDs und die Tabulator-Reihenfolge: Screenreader
 * lesen jede Zeile zweimal vor, und die Tastaturnavigation läuft durch eine
 * unsichtbare Kopie. Für reine Sichtbarkeit bleiben Tailwind-Klassen der
 * einfachere und flackerfreie Weg.
 *
 * Im Server-Render und während der Hydration ist das Ergebnis `false`,
 * bewusst, damit Server- und Client-Render übereinstimmen und React keine
 * Hydrations-Abweichung meldet. Aufrufer legen deshalb die Desktop-Variante
 * als `false`-Fall aus. Wird die Komponente erst im Client eingehängt (ein
 * Menü nach dem Tippen, eine Seite nach einem Seitenwechsel), steht der echte
 * Wert schon im ersten Render fest (#8013): Ein Telefon sieht dann nie erst
 * die Desktop-Variante.
 */
export function useMediaQuery(query: string): boolean {
  return useResolvedMediaQuery(query) ?? false;
}

const noSubscription = () => () => undefined;
const unknownOnServer = () => null;

interface MediaQueryStore {
  getSnapshot(): boolean;
  subscribe(onChange: () => void): () => void;
}

// Menus and their panels often read the same breakpoint. They can share
// one live list and browser subscription for as long as someone reads it.
const storesByMatchMedia = new WeakMap<
  Window["matchMedia"],
  Map<string, MediaQueryStore>
>();

function mediaQueryStore(query: string): MediaQueryStore | null {
  const matchMedia = window.matchMedia;
  if (typeof matchMedia !== "function") return null;
  let stores = storesByMatchMedia.get(matchMedia);
  if (!stores) {
    stores = new Map();
    storesByMatchMedia.set(matchMedia, stores);
  }
  const existing = stores.get(query);
  if (existing) return existing;

  const owner = stores;
  const list = matchMedia.call(window, query);
  const listeners = new Set<() => void>();
  let matches = list.matches;
  const notify = () => {
    const next = list.matches;
    if (matches === next) return;
    matches = next;
    for (const listener of listeners) listener();
  };
  const store: MediaQueryStore = {
    getSnapshot: () => matches,
    subscribe(onChange) {
      if (listeners.size === 0) {
        list.addEventListener("change", notify);
        matches = list.matches;
      }
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
        if (listeners.size !== 0) return;
        list.removeEventListener("change", notify);
        if (owner.get(query) === store) owner.delete(query);
      };
    },
  };
  stores.set(query, store);
  return store;
}

/**
 * Wie `useMediaQuery`, aber ohne Vorgabe vor der Hydration: `null` heißt
 * „noch unbekannt“. So kann ein Aufrufer bis dahin beide Darstellungen per
 * CSS umschalten (kein Flackern, Server- und Client-Render gleich) und danach
 * nur die passende im Dokument behalten. Bei einem Seitenwechsel im Client
 * steht der Wert schon im ersten Render fest. Ohne `matchMedia` (jsdom)
 * bleibt der Wert `null`.
 */
export function useResolvedMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) =>
      mediaQueryStore(query)?.subscribe(onChange) ?? noSubscription(),
    [query],
  );
  const getSnapshot = useCallback(
    () => mediaQueryStore(query)?.getSnapshot() ?? null,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, unknownOnServer);
}

/**
 * Tailwinds Breakpoints, wie sie `--breakpoint-*` im Theme festlegt
 * (`tailwindcss/theme.css`, `globals.css` überschreibt sie nicht).
 * `tailwind-breakpoints.test.ts` liest beide Dateien und hält diese Werte
 * gleich. Sie stehen in rem: Ein Media-Query-`rem` folgt der Standardschrift
 * des Browsers, die Grenze verschiebt sich also mit ihr (20 px Schrift: `md`
 * bei 960 px).
 */
export const TAILWIND_BREAKPOINTS = {
  sm: "40rem",
  md: "48rem",
  lg: "64rem",
  xl: "80rem",
} as const;

export type TailwindBreakpoint = keyof typeof TAILWIND_BREAKPOINTS;

/** Trifft genau dort zu, wo Tailwinds `<bp>:`-Varianten greifen. */
export function atLeast(breakpoint: TailwindBreakpoint): string {
  return `(min-width: ${TAILWIND_BREAKPOINTS[breakpoint]})`;
}

/**
 * Das exakte Gegenstück zu `atLeast`: trifft auf jede Breite zu, auf der
 * Tailwinds `<bp>:`-Varianten nicht greifen, auch auf Bruchteile wie
 * 767,5 px. Ein `max-width` mit px-Abzug ließe dort eine Lücke und hinge
 * nicht an der Browserschrift.
 */
export function below(breakpoint: TailwindBreakpoint): string {
  return `not all and ${atLeast(breakpoint)}`;
}

/**
 * Von `from` (einschließlich) bis unter `until`, wie Tailwinds
 * `<from>:max-<until>:`. Bereichssyntax, weil `not` in einer Und-Verknüpfung
 * nur geklammert gilt.
 */
export function between(
  from: TailwindBreakpoint,
  until: TailwindBreakpoint,
): string {
  return `(${TAILWIND_BREAKPOINTS[from]} <= width < ${TAILWIND_BREAKPOINTS[until]})`;
}

/** Unter Tailwinds `sm`: ein Telefon-Format. */
export const BELOW_SM = below("sm");
/** Unter Tailwinds `md`: Toasts wechseln in die Dialogdarstellung. */
export const BELOW_MD = below("md");
/** Unter Tailwinds `lg`: kein Platz für breite Wochenraster. */
export const BELOW_LG = below("lg");
/** Unter Tailwinds `xl`. */
export const BELOW_XL = below("xl");
/** Ab Tailwinds `md`. */
export const AT_LEAST_MD = atLeast("md");
/** Ab Tailwinds `lg`: die Desktop-Seitenleiste ist sichtbar. */
export const AT_LEAST_LG = atLeast("lg");
/** Ab Tailwinds `xl`. */
export const AT_LEAST_XL = atLeast("xl");

/*
 * Zeigerart: Sie entscheidet Bedienmaße und Trefferflächen, die Breite
 * Struktur und Seitenraster (ADR 0323). Gefragt wird nach dem Hauptzeiger
 * (`pointer`), nicht nach irgendeinem (`any-pointer`): Ein Laptop mit
 * Touchscreen bleibt fein, ein iPad grob. In CSS gelten Tailwinds `pointer-coarse:` und `pointer-fine:`.
 */

/** Finger als Hauptzeiger: Telefon, iPad. Bedienelemente mit Fingermaß. */
export const COARSE_POINTER = "(pointer: coarse)";
/** Maus oder Trackpad als Hauptzeiger: Bedienelemente mit Mausmaß. */
export const FINE_POINTER = "(pointer: fine)";
