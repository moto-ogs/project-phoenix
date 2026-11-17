import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { berlinTodayISO } from "../src/lib/date-helpers";

// Die Uhr der Playwright-Flows (#7296).
//
// Browser, Next-Server, Backend und Datenbank eines Laufs lesen die Uhr
// desselben Rechners; eine Spec kann sie nicht wie Vitest einfrieren. Darum
// gibt es genau eine Stelle, die den Tag des Laufs liest, und eine, die das
// Heute des Browsers verstellt. In CI stellt e2e.yml die Uhr des Runners vor
// dem Seed auf den nächsten Betreuungstag (Werktag, kein Feiertag in NRW):
// Alle vier laufen dann auf diesem Tag, auch am Wochenende.
//
// Die oxlint-Regel `test-clock/no-real-clock` lehnt unter `e2e/` jedes
// andere Lesen ab (`new Date()`, `Date.now()`, `berlinTodayISO()`). Dauern
// und Fristen misst `performance.now()`; eine Stelle, die einen
// Wanduhr-Stempel braucht, nennt ihren Grund in `realClock("…")`
// (real-clock.mjs).

/**
 * Der Berliner Kalendertag des Laufs (`YYYY-MM-DD`): der Tag, den auch
 * Next-Server, Backend und Seed sehen. Der lokale Tag des Runners (in CI UTC)
 * ist bis 01:00 oder 02:00 Uhr Berliner Zeit noch der Vortag (#6419).
 */
export function runToday(): string {
  return berlinTodayISO();
}

/**
 * Stellt das Heute des Browsers fest auf den Berliner Tag `day`; Timer und
 * Netzwerk laufen weiter. Für einen Flow, der einen bestimmten Tag im Browser
 * braucht, etwa einen Schultag am Wochenende. Server und Backend bleiben auf
 * dem Tag des Laufs: Der Flow darf nur Daten mit ausdrücklichem Datum
 * schreiben. 00:30 Uhr MEZ ist im Sommer 01:30 Uhr und im UTC-Browser noch
 * der Vortag; der Fall, an dem Berliner und lokaler Tag auseinanderfallen.
 */
export async function setBrowserDay(page: Page, day: string): Promise<void> {
  await page.clock.setFixedTime(new Date(`${day}T00:30:00+01:00`));
}

/**
 * Ein Titel, den kein anderer Lauf auf derselben Datenbank schon angelegt
 * hat. Kein Zeitstempel: Zwei Läufe in derselben Millisekunde bekämen
 * denselben.
 */
export function uniqueTitle(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}
