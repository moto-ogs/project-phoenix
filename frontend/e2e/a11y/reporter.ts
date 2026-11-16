import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { writeFileSync } from "node:fs";

import {
  foundRules,
  readBaseline,
  selectsSubset,
  shrink,
  type ScanRecord,
} from "../../scripts/a11y-baseline";
import { BASELINE_PATH, SCAN_ATTACHMENT, type ScanReport } from "./scan";

// Abschluss des A11y-Ratchets (#7107): sammelt die Prüfungen aller Tests,
// nennt ihre Laufzeit und meldet, welche Einträge der Baseline entfallen
// können. Mit A11Y_BASELINE_SHRINK=1 streicht er sie selbst, aber nur nach
// einem grünen, vollen Lauf ohne übersprungene Tests, Shard, Dateifilter oder
// --grep: Ein Teillauf sieht nicht jede Route und würde zu viel streichen. Er
// nimmt nie eine Regel oder Route auf.

export default class A11yReporter implements Reporter {
  private config: FullConfig | null = null;
  private readonly records: ScanRecord[] = [];
  private scansComplete = true;
  private hasSkippedTests = false;
  private ms = 0;
  private settleMs = 0;

  onBegin(config: FullConfig): void {
    this.config = config;
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    this.hasSkippedTests ||= result.status === "skipped";
    for (const attachment of result.attachments) {
      if (attachment.name !== SCAN_ATTACHMENT || !attachment.body) continue;
      const report = JSON.parse(attachment.body.toString("utf8")) as ScanReport;
      this.scansComplete &&= report.complete;
      this.records.push(...report.records);
      this.ms += report.ms;
      this.settleMs += report.settleMs;
    }
  }

  onEnd(result: FullResult): void {
    if (this.records.length === 0) return;
    const routes = new Set(this.records.map((record) => record.route)).size;
    console.log(
      `A11y: ${this.records.length} Prüfungen auf ${routes} Routen, ${(this.ms / 1000).toFixed(1)} s, davon ${(this.settleMs / 1000).toFixed(1)} s Warten auf geladene Seiten.`,
    );
    const complete =
      result.status === "passed" &&
      this.scansComplete &&
      !this.hasSkippedTests &&
      this.config?.shard === null &&
      !selectsSubset(process.argv);
    const baseline = readBaseline(BASELINE_PATH);
    const seen = foundRules(this.records);
    // Ein Teillauf (CI-Shard, eine Datei) meldet nur Routen, die er sah.
    const { next, hints } = shrink(
      complete
        ? baseline
        : {
            ...baseline,
            routes: Object.fromEntries(
              Object.entries(baseline.routes).filter(([route]) =>
                seen.has(route),
              ),
            ),
          },
      seen,
    );
    if (hints.length === 0) return;
    const lines = hints.map((hint) => `  ${hint}`);
    if (process.env.A11Y_BASELINE_SHRINK === "1" && complete) {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
      console.log(
        [`A11y-Baseline gekürzt (${hints.length}):`, ...lines].join("\n"),
      );
      return;
    }
    console.log(
      [
        complete
          ? "A11y-Baseline kann kürzer werden: A11Y_BASELINE_SHRINK=1 pnpm run test:e2e. Ohne behobene Ursache nicht kürzen: Manche Funde hängen an Daten oder am Wochentag, ein Lauf ohne sie beweist nichts, und der nächste Lauf mit ihnen wäre rot."
          : "A11y-Baseline: Hinweise aus einem Teillauf; kürzen darf nur ein grüner, voller Lauf:",
        ...lines,
      ].join("\n"),
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}
