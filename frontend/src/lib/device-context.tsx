"use client";

/**
 * Gerätekontext (Prototyp Mobile-Zielbild, #8070).
 *
 * Die Breite bestimmt den Aufbau, die Zeigerart die Bedienmaße. Daraus folgt
 * genau eine Oberfläche:
 *
 *   - `desktop`: ab 640 px, also Desktop und iPad. Der heutige Code, unverändert.
 *   - `phone`:   App unter 640 px (Telefon).
 *
 * `tablet` und `split` kommen nicht mehr vor: Das iPad behält die heutige
 * Oberfläche (Entscheid nach dem Prototyp). CSS-Gegenstücke: `app:`, `desk:`, `phone:`,
 * `tablet:`, `split:` in `styles/globals.css`.
 *
 * Vor der Hydration ist der Kontext unbekannt (`resolved: false`). Bausteine
 * schalten bis dahin per CSS (`DeviceSwitch`), damit Server- und Client-
 * Render gleich bleiben und der Desktop nie eine App-Variante sieht.
 */
import { useCallback, useSyncExternalStore, type ReactNode } from "react";

/*
 * Eigene Abfrage statt `useResolvedMediaQuery`: Viele Tests ersetzen
 * `~/lib/hooks/use-media-query` durch einen Mock ohne diese Funktion. Der
 * Gerätekontext steckt in Kit-Bausteinen (Modal, Blatt), die diese Tests
 * mitrendern; er darf deshalb nicht an jenem Modul hängen. Ohne `matchMedia`
 * (jsdom) bleibt der Wert `null` = Desktop.
 */
const noSubscription = () => () => undefined;
const unknownOnServer = () => null;

function useResolvedMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return noSubscription();
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () =>
      typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : null,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, unknownOnServer);
}

export const APP_QUERY = "(width < 40rem)";
const PHONE_QUERY = "(width < 40rem)";
// Das iPad behält die heutige Oberfläche: kein `split`, kein `tablet`.
const SPLIT_QUERY = "not all";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type DeviceLayout = "phone" | "tablet" | "desktop";

export interface DeviceContextValue {
  /** `false` bis zur Hydration; dann gelten die Defaults (Desktop). */
  resolved: boolean;
  layout: DeviceLayout;
  /** App-Oberfläche (Telefon oder iPad). */
  isApp: boolean;
  /** iPad quer: Liste neben Detail. */
  isSplit: boolean;
  input: "touch" | "pointer";
}

export function useDeviceContext(): DeviceContextValue {
  const app = useResolvedMediaQuery(APP_QUERY);
  const phone = useResolvedMediaQuery(PHONE_QUERY);
  const split = useResolvedMediaQuery(SPLIT_QUERY);
  const coarse = useResolvedMediaQuery("(pointer: coarse)");
  const resolved = app !== null;
  const isApp = app === true;
  let layout: DeviceLayout = "desktop";
  if (isApp) layout = phone === true ? "phone" : "tablet";
  return {
    resolved,
    layout,
    isApp,
    isSplit: isApp && split === true,
    input: coarse === true ? "touch" : "pointer",
  };
}

/** `true` nur, wenn sicher die App-Oberfläche gilt. */
export function useIsApp(): boolean {
  return useDeviceContext().isApp;
}

/**
 * Zeigt `desktop` auf dem Desktop und `app` in der App. Vor der Hydration
 * stehen beide im Dokument und CSS blendet um (`display: contents`, damit
 * der Desktop-Zweig keine eigene Box bekommt); danach bleibt nur der
 * passende Zweig, der Desktop ohne Hülle.
 */
export function DeviceSwitch({
  desktop,
  app,
}: {
  desktop: ReactNode;
  app: ReactNode;
}) {
  const { resolved, isApp } = useDeviceContext();
  if (resolved) return <>{isApp ? app : desktop}</>;
  return (
    <>
      <div className="app:hidden contents">{desktop}</div>
      <div className="app:contents hidden">{app}</div>
    </>
  );
}
