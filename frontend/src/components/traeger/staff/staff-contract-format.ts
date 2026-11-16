/**
 * Wörter und Rechnungen der Arbeitsverträge einer Personalakte (#4706): Art,
 * Laufzeit, das Soll Montag bis Freitag in Stunden und die Ferienwochen.
 */
import type { StatusBadgeTone } from "~/components/ui/status-badge";
import {
  formatDecimalHours,
  parseDecimalHours,
} from "~/components/staff/arbeitszeit-hours";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import type {
  StaffContract,
  StaffContractKind,
  StaffContractSite,
} from "~/lib/traeger-staff-api";

export const CONTRACT_KIND_LABELS: Readonly<Record<StaffContractKind, string>> =
  {
    part_time: "Teilzeit",
    full_time: "Vollzeit",
    minijob: "Minijob",
    uebungsleiter: "Übungsleiter",
    ehrenamt: "Ehrenamt",
  };

export const CONTRACT_KINDS: readonly StaffContractKind[] = [
  "part_time",
  "full_time",
  "minijob",
  "uebungsleiter",
  "ehrenamt",
];

/**
 * Was eine Art für die Abrechnung heißt (#4712). Jede Art bekommt im
 * Lohnexport eigene Lohnarten, so bleiben zum Beispiel Minijob und
 * Übungsleiterpauschale getrennt.
 */
export const CONTRACT_KIND_HINTS: Readonly<Record<StaffContractKind, string>> =
  {
    part_time: "Weniger als volle Stunden.",
    full_time: "Volle Wochenstunden.",
    minijob: "Geringfügig beschäftigt.",
    uebungsleiter: "Mit Übungsleiterpauschale.",
    ehrenamt: "Mit Ehrenamtspauschale.",
  };

/** Montag bis Freitag, die Tage, für die ein Soll gilt. */
export const CONTRACT_WEEKDAYS = [
  { short: "Mo", name: "Montag" },
  { short: "Di", name: "Dienstag" },
  { short: "Mi", name: "Mittwoch" },
  { short: "Do", name: "Donnerstag" },
  { short: "Fr", name: "Freitag" },
] as const;

/** Die Summe einer Woche in Minuten. */
export function weekMinutes(minutes: readonly number[]): number {
  return minutes.reduce((sum, value) => sum + value, 0);
}

/** Stunden wie „7,5 Std.“, eine freie Stelle als „–“. */
export function hoursLabel(minutes: number, dashForZero = false): string {
  if (dashForZero && minutes === 0) return "–";
  return `${formatDecimalHours(minutes)} Std.`;
}

/** Eine Woche in einer Zeile: „Mo–Do je 7 Std. · Fr 5 Std.“ */
export function weekPattern(minutes: readonly number[]): string {
  const parts: string[] = [];
  let start = 0;
  while (start < minutes.length) {
    let end = start;
    while (end + 1 < minutes.length && minutes[end + 1] === minutes[start]) {
      end++;
    }
    const value = minutes[start] ?? 0;
    const hours = value === 0 ? "frei" : hoursLabel(value);
    const from = CONTRACT_WEEKDAYS[start]?.short;
    const to = CONTRACT_WEEKDAYS[end]?.short;
    parts.push(
      end === start
        ? `${from} ${hours}`
        : `${from}–${to} ${value === 0 ? "frei" : `je ${hours}`}`,
    );
    start = end + 1;
  }
  return parts.join(" · ");
}

/** Das Soll, das ein Einsatzort an einem Tag hat. */
export function sollOn(site: StaffContractSite, day: string) {
  return site.soll.find((soll) => soll.validFrom <= day) ?? null;
}

/** Das neueste Soll eines Einsatzorts. */
export function latestSoll(site: StaffContractSite) {
  return site.soll[0] ?? null;
}

export type ContractPhase = "upcoming" | "running" | "ended";

export function contractPhase(
  contract: StaffContract,
  today: string,
): ContractPhase {
  if (contract.startsOn > today) return "upcoming";
  if (contract.endsOn !== null && contract.endsOn < today) return "ended";
  return "running";
}

export const CONTRACT_PHASE_TONES: Readonly<
  Record<ContractPhase, StatusBadgeTone>
> = {
  upcoming: "blue",
  running: "green",
  ended: "gray",
};

export function contractPhaseLabel(
  contract: StaffContract,
  phase: ContractPhase,
): string {
  if (phase === "upcoming")
    return `Beginnt am ${formatDate(contract.startsOn)}`;
  if (phase === "ended") return "Beendet";
  return "Läuft";
}

/** Die Laufzeit: „seit 01.08.2026“ oder „01.08.2026 bis 31.12.2026“. */
export function contractTerm(contract: StaffContract): string {
  if (contract.endsOn === null) return `seit ${formatDate(contract.startsOn)}`;
  return `${formatDate(contract.startsOn)} bis ${formatDate(contract.endsOn)}`;
}

/** Das Soll pro Woche über alle Einsatzorte an einem Tag. */
export function contractWeekMinutes(
  contract: StaffContract,
  day: string,
): number {
  return contract.sites.reduce((sum, site) => {
    const soll = sollOn(site, day) ?? latestSoll(site);
    return sum + (soll ? weekMinutes(soll.weekdayMinutes) : 0);
  }, 0);
}

/** Der späteste Tag, ab dem alle Einsatzorte eine Änderung zulassen. */
export function changeableFrom(sites: readonly StaffContractSite[]): string {
  return sites.reduce(
    (latest, site) =>
      site.changeableFrom > latest ? site.changeableFrom : latest,
    "",
  );
}

/** Der Montag der Woche eines Tags. */
export function mondayOf(day: string): string {
  const date = parseISODate(day);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return toISODate(date);
}

/** Der Freitag der Woche, die an einem Montag beginnt. */
export function fridayOf(monday: string): string {
  const date = parseISODate(monday);
  date.setDate(date.getDate() + 4);
  return toISODate(date);
}

/** Wie viele Wochen von einem Montag bis zu einem anderen. */
export function weekCount(fromMonday: string, toMonday: string): number {
  const from = parseISODate(fromMonday).getTime();
  const to = parseISODate(toMonday).getTime();
  return Math.round((to - from) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

/** Stunden-Felder Montag bis Freitag aus Minuten. */
export function hoursFields(minutes: readonly number[] | null): string[] {
  return CONTRACT_WEEKDAYS.map((_, index) =>
    minutes ? formatDecimalHours(minutes[index] ?? 0) : "",
  );
}

/**
 * Minuten aus Stunden-Feldern. Ein leeres Feld zählt als frei. `null`, wenn
 * ein Feld keine Zahl von 0 bis 12 ist.
 */
export function parseHoursFields(fields: readonly string[]): number[] | null {
  const minutes: number[] = [];
  for (const field of fields) {
    const parsed = parseDecimalHours(field);
    if (parsed.status === "invalid") return null;
    minutes.push(parsed.status === "valid" ? parsed.minutes : 0);
  }
  return minutes;
}

/** Ob alle Stunden-Felder leer sind. */
export function hoursFieldsEmpty(fields: readonly string[]): boolean {
  return fields.every((field) => field.trim() === "");
}
