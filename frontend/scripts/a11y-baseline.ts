import { readFileSync } from "node:fs";

// Reine Logik des A11y-Ratchets (#7107), ohne Browser: Routen-Schlüssel,
// Vergleich mit der Baseline und das Kürzen. Die Prüfung selbst steckt in
// e2e/a11y/scan.ts, die Zusammenfassung in e2e/a11y/reporter.ts.

export interface Baseline {
  /** Warum eine Regel in der Baseline steht, mit Issue. Pflicht je Regel. */
  reasons: Record<string, string>;
  /**
   * Route → axe-Regeln, die dort als offene Schuld bekannt sind, sortiert.
   * Eine Anzahl steht bewusst nicht dabei (#7196): Wie viele Knoten eine
   * Regel trifft, hängt an den Daten und am Tag. Dieselbe Seite zeigte je
   * nach Woche 2, 6 oder 8 Stellen, und der erste Werktagslauf nach einer am
   * Sonntag gemessenen Baseline war rot, ohne dass sich Code geändert hatte.
   */
  routes: Record<string, string[]>;
}

export interface ScanRecord {
  route: string;
  /** axe-Regel mit Fund → betroffene Knoten; die Zahl steht nur in der Meldung. */
  counts: Record<string, number>;
}

/** Liest die Baseline; jede Regel darin braucht eine Begründung. */
export function readBaseline(path: string): Baseline {
  const baseline = JSON.parse(readFileSync(path, "utf8")) as Baseline;
  const missing = new Set<string>();
  for (const [route, rules] of Object.entries(baseline.routes)) {
    if (!Array.isArray(rules)) {
      throw new Error(
        `A11y-Baseline: "${route}" braucht eine Liste von Regeln, keine Anzahl je Regel.`,
      );
    }
    for (const rule of rules) {
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
 * Regeln mit Funden, die für die Route nicht in der Baseline stehen. Eine
 * gelistete Regel besteht mit jeder Knotenzahl: Neue Stellen einer bekannten
 * Regel auf derselben Route fallen hier nicht auf, bis der Eintrag entfällt.
 */
export function unlisted(
  baseline: Baseline,
  record: ScanRecord,
): Array<{ rule: string; count: number }> {
  const known = new Set(baseline.routes[record.route]);
  return Object.entries(record.counts)
    .filter(([rule]) => !known.has(rule))
    .map(([rule, count]) => ({ rule, count }));
}

/** Route → Regeln, die mindestens eine Prüfung des Laufs dort fand. */
export function foundRules(
  records: readonly ScanRecord[],
): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const { route, counts } of records) {
    const rules = found.get(route) ?? new Set<string>();
    for (const rule of Object.keys(counts)) rules.add(rule);
    found.set(route, rules);
  }
  return found;
}

/**
 * Gekürzte Baseline nach einem vollen Lauf: Regeln, die keine Prüfung der
 * Route mehr findet, entfallen; nie kommen Routen oder Regeln dazu. Routen,
 * die kein Test mehr öffnet, entfallen.
 */
export function shrink(
  baseline: Baseline,
  found: Map<string, Set<string>>,
): { next: Baseline; hints: string[] } {
  const hints: string[] = [];
  const routes: Baseline["routes"] = {};
  for (const [route, rules] of Object.entries(baseline.routes)) {
    const foundHere = found.get(route);
    if (!foundHere) {
      hints.push(`${route}: in keinem Test geprüft, Eintrag entfällt`);
      continue;
    }
    const kept = rules.filter((rule) => {
      if (foundHere.has(rule)) return true;
      hints.push(`${route}: ${rule} nicht mehr gefunden, Eintrag entfällt`);
      return false;
    });
    if (kept.length > 0) routes[route] = kept;
  }
  const used = new Set(Object.values(routes).flat());
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
