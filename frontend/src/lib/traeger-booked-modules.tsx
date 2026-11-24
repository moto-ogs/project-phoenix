"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ModuleKey } from "~/lib/modules";

/**
 * Die gebuchten moto-Module des Trägers der Sitzung (#6052), einmal im
 * Portalrahmen gelesen (`GET /traeger/organization/`) und von dort an
 * Seiten und Karten gereicht.
 *
 * `modules` ist `null`, solange der Rahmen lädt oder nicht lesbar war;
 * `settled` sagt, ob die Antwort (oder ihr Fehler) schon da ist.
 */
export interface TraegerBookedModules {
  readonly modules: readonly ModuleKey[] | null;
  readonly settled: boolean;
}

const TraegerBookedModulesContext = createContext<
  TraegerBookedModules | undefined
>(undefined);

export function TraegerBookedModulesProvider({
  value,
  children,
}: {
  readonly value: TraegerBookedModules;
  readonly children: ReactNode;
}) {
  return (
    <TraegerBookedModulesContext.Provider value={value}>
      {children}
    </TraegerBookedModulesContext.Provider>
  );
}

/**
 * Ob der Träger ein moto-Modul gebucht hat, für eine Karte oder eine Abfrage
 * auf einer Seite eines anderen Moduls: die Zahlungskarten eines Vertrags,
 * die Abrechnungsregeln der Einstellungen, „Zur Abrechnung“ eines
 * Ferienzeitraums.
 *
 * `null`, solange der Rahmen lädt: noch nichts lesen, damit keine Anfrage
 * nur deshalb abgelehnt wird, weil sie zu früh kam. War der Rahmen nicht
 * lesbar oder fehlt er ganz (eine Seite ohne Portalrahmen, ein Test), gilt
 * das Modul als gebucht; das Backend sperrt seine Routen selbst.
 */
export function useTraegerModuleBooked(module: ModuleKey): boolean | null {
  const booked = useContext(TraegerBookedModulesContext);
  if (booked === undefined) return true;
  if (booked.modules) return booked.modules.includes(module);
  return booked.settled ? true : null;
}
