/**
 * Das Startziel des Träger-Portals (#7646, Spec #7546): das Dashboard
 * („Übersicht“), wenn die Person es öffnen darf, sonst die Schulliste. Jeder
 * Einstieg nimmt es von hier: Anmeldung, angenommene Einladung, Logo und
 * Startadresse des Portalrahmens, Standard-Rückweg aus den Einstellungen.
 * Der Zurück-Link der Schulansicht führt weiter zur Schulliste.
 *
 * Bewusst ohne die Navigationsliste: Der Portalrahmen gilt für jedes Portal,
 * deren Konzept-Icons gehören nicht in fremde Bundles. Dass dieses Recht das
 * Recht des Dashboard-Eintrags ist, prüft `traeger-home.test.ts`.
 */
import type { Session } from "next-auth";
import { getSession } from "next-auth/react";
import { hasPermission } from "~/lib/auth-utils";
import { traegerPath } from "~/lib/traeger-url";

/** So lange wartet die Anmeldung höchstens auf die neue Sitzung. */
const SESSION_WAIT_MS = 5000;

/** Das Recht, das das Dashboard öffnet (#4674). */
const DASHBOARD_RIGHT = "traeger_overview:read";
const DASHBOARD_PATH = "/traeger/uebersicht";
const SCHOOLS_PATH = "/traeger";

/** Das Startziel mit /traeger-Präfix; ohne bekannte Sitzung die Schulliste. */
export function traegerHomePath(session: Session | null): string {
  return hasPermission(session, DASHBOARD_RIGHT)
    ? DASHBOARD_PATH
    : SCHOOLS_PATH;
}

/** Das Startziel als Adresse für diesen Host. */
export function traegerHomeHref(session: Session | null): string {
  return traegerPath(traegerHomePath(session));
}

/**
 * Das Startziel direkt nach einer Anmeldung: Der Provider kennt die neue
 * Sitzung noch nicht, also liest sie diese Funktion einmal. Kommt keine
 * Sitzung (Fehler, null oder keine Antwort nach `SESSION_WAIT_MS`), führt sie
 * zur Schulliste, die jede Person öffnen darf; die Anmeldung bleibt nie im
 * Ladezustand stehen.
 */
export async function fetchTraegerHomeHref(): Promise<string> {
  const noAnswer = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), SESSION_WAIT_MS);
  });
  const session = await Promise.race([
    getSession({ broadcast: false }).catch(() => null),
    noAnswer,
  ]);
  return traegerHomeHref(session);
}
