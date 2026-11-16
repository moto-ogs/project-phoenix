import { berlinClockFromISO } from "~/lib/date-helpers";

// Tageszeit-Gruß, geteilt von Dashboard und Klassenansicht. Er folgt der
// Schulzeit (Europe/Berlin), wie jede Uhrzeit in moto (#6471): Server und
// Browser rechnen so denselben Gruß, ganz gleich, in welcher Zone sie laufen.
// Bewusst KEIN toLocaleString-Parsing: de-DE liefert "14 Uhr", Number() davon
// ist NaN und der Gruß bliebe für immer "Guten Abend".
export function getTimeBasedGreeting(now: Date = new Date()): string {
  const hour = Number(berlinClockFromISO(now.toISOString()).slice(0, 2));
  if (hour < 12) return "Guten Morgen";
  if (hour < 17) return "Guten Tag";
  return "Guten Abend";
}

/**
 * Der Tageszeit-Gruß für Seiten, die der Server vorrendert. Früher rendert der
 * Server "Hallo" und der Browser tauschte es nach der Hydration aus (#3764);
 * beim Neuladen sprang der Titel deshalb sichtbar um. Mit der Schulzeit steht
 * auf beiden Seiten derselbe Gruß. Nur wenn Server-Render und Hydration genau
 * über 12 oder 17 Uhr fallen, unterscheiden sie sich; die Seitenüberschrift
 * (`TenantPage`) nimmt diesen einen Textunterschied ohne Hydration-Fehler hin.
 */
export function useTimeBasedGreeting(): string {
  return getTimeBasedGreeting();
}
