import AxeBuilder from "@axe-core/playwright";
import { test as base, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";

import {
  distinctNodes,
  exceeding,
  readBaseline,
  routeKey,
  type Baseline,
  type ScanRecord,
} from "../../scripts/a11y-baseline";

// A11y-Ratchet (#7107): axe prüft jede Seite, die eine E2E-Spec ansteuert.
// Die Baseline zählt Stellen pro Route und axe-Regel: Knoten ohne Position
// in Listen, siehe distinctNodes. Mehr als die Baseline
// macht den Test rot, weniger meldet reporter.ts als Hinweis, die Baseline zu
// senken. Fingerprints pro Knoten gibt es bewusst nicht: Sie brechen bei
// jedem Umbau und laden dazu ein, die Baseline blind neu zu erzeugen (Spec
// in #2790).
//
// Specs importieren `test` und `expect` von hier statt von
// "@playwright/test". Der Fixture-Wrapper prüft nach `page.goto`,
// `page.reload` und `page.waitForURL`, sobald die Seite geladen ist, und am
// Ende eines grünen Tests die zuletzt offene Seite. Jede Route einmal je
// Worker (in CI je Shard), weil axe auf großen Seiten Sekunden braucht;
// Telefon-Breiten zählen als eigene Route (`@mobil`).

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export const BASELINE_PATH = join(import.meta.dirname, "baseline.json");
export const SCAN_ATTACHMENT = "a11y-scan";

/** Was ein Test geprüft hat, als Anhang für reporter.ts. */
export interface ScanReport {
  records: ScanRecord[];
  /** Kein Analysefehler und keine ausgeschöpften Navigationsversuche. */
  complete: boolean;
  /** Zeit für Warten und axe, in Millisekunden. */
  ms: number;
  /** Anteil davon fürs Warten auf das Ende der Ladeanzeigen. */
  settleMs: number;
}

/**
 * Wartet, bis keine Ladeanzeige mehr sichtbar ist (aria-busy, Skelett), damit
 * axe den geladenen Zustand zählt und nicht das Skelett. Zwei leere Messungen
 * hintereinander, höchstens 10 s. Gibt bei Zeitablauf die Anzeige zurück,
 * die noch lief.
 */
async function settle(page: Page): Promise<string | null> {
  await page.waitForLoadState("domcontentloaded");
  const deadline = Date.now() + 10_000;
  let quiet = 0;
  let busy: string | null = null;
  while (Date.now() < deadline && quiet < 2) {
    busy = await page
      .evaluate(() => {
        const element = Array.from(
          document.querySelectorAll('[aria-busy="true"], .animate-pulse'),
        ).find((candidate) => {
          if (candidate.matches('[aria-busy="true"]')) return true;
          if (candidate instanceof SVGElement) return false;
          const rect = candidate.getBoundingClientRect();
          return rect.width > 8 || rect.height > 8;
        });
        return element ? element.outerHTML.slice(0, 120) : null;
      })
      .catch(() => "Seite nicht lesbar");
    quiet = busy === null ? quiet + 1 : 0;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return quiet < 2 ? busy : null;
}

interface Violation {
  id: string;
  help: string;
  helpUrl: string;
  nodes: Array<{ target: unknown[] }>;
}

async function analyze(page: Page): Promise<Violation[]> {
  const result = await new AxeBuilder({ page })
    .withTags(A11Y_TAGS)
    // Next-Dev-Werkzeuge gibt es nur im Dev-Server, nicht im Produkt.
    .exclude("nextjs-portal")
    .analyze();
  return result.violations as Violation[];
}

export class A11yRecorder {
  readonly records: ScanRecord[] = [];
  complete = true;
  ms = 0;
  settleMs = 0;
  private readonly violations = new Map<string, Violation[]>();
  private readonly errors: string[] = [];

  constructor(
    private readonly baseline: Baseline,
    private readonly info: TestInfo,
    /** Im Worker schon geprüfte Routen. */
    private readonly scanned: Set<string>,
  ) {}

  private routeOf(page: Page, state?: string): string | null {
    if (page.isClosed()) return null;
    const address = page.url();
    if (!address.startsWith("http")) return null;
    const phone = (page.viewportSize()?.width ?? 1280) < 640;
    return (
      routeKey(address, process.env) +
      (phone ? " @mobil" : "") +
      (state ? ` (${state})` : "")
    );
  }

  /**
   * Prüft die aktuelle Seite einmal je Route; `state` trennt Zustände
   * derselben Route. Leitet die Seite während der Prüfung weiter, zählt das
   * Ergebnis nicht, und die neue Seite wird geprüft.
   */
  async scan(page: Page, state?: string): Promise<void> {
    const started = Date.now();
    try {
      await this.scanOnce(page, state);
    } catch (error) {
      this.complete = false;
      this.errors.push(
        `${this.routeOf(page, state) ?? page.url()}: ${String(error)}`,
      );
      throw error;
    } finally {
      this.ms += Date.now() - started;
    }
  }

  private async scanOnce(page: Page, state?: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = this.routeOf(page, state);
      if (!before) {
        if (attempt > 0) this.complete = false;
        return;
      }
      if (this.scanned.has(before)) return;
      const settleStarted = Date.now();
      const busy = await settle(page);
      this.settleMs += Date.now() - settleStarted;
      if (busy) {
        this.info.annotations.push({
          type: "a11y",
          description: `${before}: Ladeanzeige nach 10 s noch sichtbar: ${busy}`,
        });
      }
      const address = page.url();
      const route = this.routeOf(page, state);
      if (!route) {
        this.complete = false;
        return;
      }
      if (this.scanned.has(route)) return;
      let violations: Violation[];
      try {
        violations = await analyze(page);
      } catch (error) {
        if (page.url() !== address) continue;
        throw error;
      }
      if (page.url() !== address) continue;
      this.scanned.add(route);
      const counts: Record<string, number> = {};
      for (const violation of violations) {
        counts[violation.id] = distinctNodes(violation.nodes);
      }
      this.records.push({ route, counts });
      this.violations.set(route, violations);
      return;
    }
    this.complete = false;
  }

  /** Fehlermeldung für jede Regel über der Baseline, sonst null. */
  failure(): string | null {
    // Auch ein Aufrufer, der einen Navigationsfehler abfängt, darf den
    // fehlgeschlagenen Scan nicht in einen grünen Test verwandeln.
    if (this.errors.length > 0) {
      return ["A11y-Analyse fehlgeschlagen:", ...this.errors].join("\n");
    }
    const lines: string[] = [];
    for (const record of this.records) {
      for (const { rule, count, allowed } of exceeding(this.baseline, record)) {
        const violation = this.violations
          .get(record.route)
          ?.find((entry) => entry.id === rule);
        lines.push(
          `${record.route}: ${rule} an ${count} Stellen, Baseline ${allowed}. ${violation?.help ?? ""} ${violation?.helpUrl ?? ""}`,
        );
        for (const node of violation?.nodes.slice(0, 5) ?? []) {
          lines.push(`    ${node.target.map(String).join(" ")}`);
        }
      }
    }
    if (lines.length === 0) return null;
    return [
      "Neue Barrierefreiheits-Verstöße (axe, WCAG 2.1 AA). Beheben; nur mit begründeter Ausnahme im PR die Baseline e2e/a11y/baseline.json erhöhen.",
      ...lines,
    ].join("\n");
  }
}

type NavigationMethod = "goto" | "reload" | "waitForURL";

export const test = base.extend<
  { a11y: A11yRecorder },
  { a11yScanned: Set<string> }
>({
  a11yScanned: [
    // Playwright verlangt das Objektmuster auch ohne Abhängigkeiten.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(new Set<string>());
    },
    { scope: "worker" },
  ],
  a11y: async ({ a11yScanned }, use, testInfo) => {
    const recorder = new A11yRecorder(
      readBaseline(BASELINE_PATH),
      testInfo,
      a11yScanned,
    );
    await use(recorder);
    if (recorder.records.length > 0 || !recorder.complete) {
      const report: ScanReport = {
        records: recorder.records,
        complete: recorder.complete,
        ms: recorder.ms,
        settleMs: recorder.settleMs,
      };
      await testInfo.attach(SCAN_ATTACHMENT, {
        body: JSON.stringify(report),
        contentType: "application/json",
      });
    }
    const failure = recorder.failure();
    if (failure) throw new Error(failure);
  },
  page: async ({ page, a11y }, use, testInfo) => {
    for (const method of ["goto", "reload", "waitForURL"] as const) {
      const original = page[method].bind(page) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      (page as unknown as Record<NavigationMethod, unknown>)[method] = async (
        ...args: unknown[]
      ) => {
        const result = await original(...args);
        await a11y.scan(page);
        return result;
      };
    }
    await use(page);
    if (testInfo.status === testInfo.expectedStatus) await a11y.scan(page);
  },
});

export { expect } from "@playwright/test";
