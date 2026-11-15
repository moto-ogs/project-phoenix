import { readFileSync } from "node:fs";

// Reine Logik des A11y-Ratchets (#7107), ohne Browser: Routen-Schlüssel,
// Vergleich mit der Baseline und das Senken. Die Prüfung selbst steckt in
// e2e/a11y/scan.ts, die Zusammenfassung in e2e/a11y/reporter.ts.

export interface Baseline {
  /** Warum eine Regel in der Baseline steht, mit Issue. Pflicht je Regel. */
  reasons: Record<string, string>;
  /** Route → axe-Regel → erlaubte Stellen (distinctNodes). */
  routes: Record<string, Record<string, number>>;
}

export interface ScanRecord {
  route: string;
  counts: Record<string, number>;
}

/** Liest die Baseline; jede Regel darin braucht eine Begründung. */
export function readBaseline(path: string): Baseline {
  const baseline = JSON.parse(readFileSync(path, "utf8")) as Baseline;
  const missing = new Set<string>();
  for (const rules of Object.values(baseline.routes)) {
    for (const rule of Object.keys(rules)) {
      if (!baseline.reasons[rule]) missing.add(rule);
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `A11y-Baseline: Regeln ohne Begründung in "reasons": ${[...missing].join(", ")}`,
    );
  }
  return baseline;
}

const PORTAL_HOSTS: ReadonlyArray<[string, string]> = [
  ["NEXT_PUBLIC_PARENTS_HOSTNAME", "eltern"],
  ["NEXT_PUBLIC_TRAEGER_HOSTNAME", "traeger"],
  ["NEXT_PUBLIC_SCHOOL_HOSTNAME", "schule"],
  ["NEXT_PUBLIC_OPERATOR_HOSTNAME", "operator"],
  ["NEXT_PUBLIC_CATERER_HOSTNAME", "caterer"],
];

const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Route einer Adresse: Portal plus Pfad, IDs als `[id]`, ohne Query.
 * Der Tenant-Slug fällt weg, damit jede Seed-Schule dieselbe Route trifft.
 */
export function routeKey(
  address: string,
  env: Record<string, string | undefined>,
): string {
  const url = new URL(address);
  const portal =
    PORTAL_HOSTS.find(([name]) => env[name] === url.host)?.[1] ??
    (url.hostname.includes(".") ? "tenant" : "web");
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => (ID_SEGMENT.test(segment) ? "[id]" : segment));
  // Öffentliche Anmeldung: der Phasen-Schlüssel ist nicht immer eine Zahl.
  if (portal === "tenant" && segments[0] === "anmeldung" && segments[1]) {
    segments[1] = "[phase]";
  }
  return `${portal} /${segments.join("/")}`;
}

/**
 * Ein axe-Selektor ohne das, was an den Daten hängt: Position in Listen
 * (`:nth-child`), Attributwerte und IDs (oft Namen), Zahlen. Die Reihenfolge
 * der Klassen wechselt zwischen Seiten, darum sortiert.
 */
function place(selector: string): string {
  return selector
    .replace(/:nth-(?:last-)?(?:child|of-type)\(\d+\)/g, "")
    .replace(/\[([\w-]+)[~|^$*]?="(?:[^"\\]|\\.)*"\]/g, "[$1]")
    .replace(/#(?:[^\s.>#:[\\]|\\.)+/g, "#id")
    .replace(/\d+/g, "0")
    .split(/(\s*>\s*|\s+)/)
    .map((compound) => {
      const [head = "", ...classes] = compound.split(/(?<!\\)\./);
      return [head, ...classes.sort()].join(".");
    })
    .join("");
}

/**
 * Verschiedene Stellen unter den Knoten einer axe-Regel (siehe place): Eine
 * Liste mit 5 oder 50 Kindern zählt gleich, die Zahl hängt am Markup, nicht
 * an den Testdaten, die parallele Specs anlegen. Roh zählten zwei Läufe auf
 * demselben Stand 31 und 43 Knoten auf /dienstplan.
 */
export function distinctNodes(
  nodes: ReadonlyArray<{ target: readonly unknown[] }>,
): number {
  const places = new Set<string>();
  for (const node of nodes) {
    places.add(node.target.flat().map(String).map(place).join(" >>> "));
  }
  return places.size;
}

/** Regeln, deren Stellenzahl über der Baseline liegt. */
export function exceeding(
  baseline: Baseline,
  record: ScanRecord,
): Array<{ rule: string; count: number; allowed: number }> {
  const allowed = baseline.routes[record.route] ?? {};
  return Object.entries(record.counts)
    .filter(([rule, count]) => count > (allowed[rule] ?? 0))
    .map(([rule, count]) => ({ rule, count, allowed: allowed[rule] ?? 0 }));
}

/** Höchste Stellenzahl je Route und Regel über alle Prüfungen eines Laufs. */
export function maxCounts(
  records: readonly ScanRecord[],
): Map<string, Record<string, number>> {
  const max = new Map<string, Record<string, number>>();
  for (const { route, counts } of records) {
    const entry = max.get(route) ?? {};
    for (const [rule, count] of Object.entries(counts)) {
      entry[rule] = Math.max(entry[rule] ?? 0, count);
    }
    max.set(route, entry);
  }
  return max;
}

/**
 * Gesenkte Baseline nach einem vollen Lauf: nur kleinere Werte, nie neue
 * Routen oder Regeln. Routen, die kein Test mehr öffnet, entfallen.
 */
export function shrink(
  baseline: Baseline,
  seen: Map<string, Record<string, number>>,
): { next: Baseline; hints: string[] } {
  const hints: string[] = [];
  const routes: Baseline["routes"] = {};
  for (const [route, rules] of Object.entries(baseline.routes)) {
    const measured = seen.get(route);
    if (!measured) {
      hints.push(`${route}: in keinem Test geprüft, Eintrag entfällt`);
      continue;
    }
    const kept: Record<string, number> = {};
    for (const [rule, allowed] of Object.entries(rules)) {
      const count = Math.min(measured[rule] ?? 0, allowed);
      if (count < allowed)
        hints.push(`${route}: ${rule} ${allowed} → ${count}`);
      if (count > 0) kept[rule] = count;
    }
    if (Object.keys(kept).length > 0) routes[route] = kept;
  }
  const used = new Set(Object.values(routes).flatMap(Object.keys));
  const reasons = Object.fromEntries(
    Object.entries(baseline.reasons).filter(([rule]) => used.has(rule)),
  );
  return { next: { reasons, routes }, hints };
}

/** Ob der Playwright-Aufruf Specs per Datei, --grep o. Ä. auswählt. */
export function selectsSubset(argv: readonly string[]): boolean {
  const index = argv.indexOf("test");
  if (index === -1) return true;
  const args = argv.slice(index + 1);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    // Optionen, die nur Ablauf oder Ausgabe ändern, nicht die Auswahl.
    if (/^(?:--(?:workers|reporter|retries|config)|-[jc])$/.test(arg)) {
      i++;
      continue;
    }
    if (/^--(?:workers|reporter|retries|config)=|^--headed$/.test(arg)) {
      continue;
    }
    return true;
  }
  return false;
}
