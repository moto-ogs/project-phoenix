#!/usr/bin/env node
// Storybook-Tests in CI (#7108): jede Story im Browser, mit axe-Prüfung.
// Der Vollauf kostet mehrere Minuten; ein Pull Request prüft deshalb nur die
// Stories, deren Importe er ändert (`vitest related`). Ohne BASE_SHA (Push,
// nightly), bei einer globalen Eingabe aller Stories oder wenn die Auswahl
// scheitert, läuft alles: die Auswahl schlägt offen fehl.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Was alle Stories betrifft, ohne dass eine es importiert: Storybook-
// Konfiguration und die Provider aus .storybook/preview.tsx, globale Styles
// und ihre Build-Konfiguration, statische Dateien, Abhängigkeiten und die
// Testkonfiguration. `vitest related` sieht diese Dateien nicht, und
// forceRerunTriggers wirkt dort nicht. Bewusst nicht dabei:
// src/i18n/messages. Texte ändern sich in gut jedem vierten Frontend-PR und
// erzwängen dort den Vollauf; Texte prüfen der Push- und der nächtliche
// Vollauf.
const GLOBAL_INPUTS = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^vitest\.storybook\.config\.ts$/,
  /^scripts\/storybook-test-changed\.mjs$/,
  /^\.storybook\//,
  /^src\/styles\//,
  /^src\/app\/providers\.tsx$/,
  /^src\/lib\/tenant-context\.tsx$/,
  /^postcss\.config\.mjs$/,
  /^tsconfig\.json$/,
  /^public\//,
];

/** Pfade relativ zu frontend/. */
export function needsFullRun(changed) {
  return changed.some((path) => GLOBAL_INPUTS.some((re) => re.test(path)));
}

const config = ["-c", "vitest.storybook.config.ts"];

function run(args) {
  const result = spawnSync("pnpm", ["exec", "vitest", ...args], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function git(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

function main() {
  const base = process.env.BASE_SHA?.trim();
  if (!base) {
    console.log("Kein BASE_SHA: alle Stories.");
    run(["run", ...config]);
  }

  // Der Checkout ist flach: die Basis als einzelnen Commit holen. Ein
  // Zwei-Punkt-Diff braucht keine Historie, nur beide Bäume.
  const fetched = git(["fetch", "--no-tags", "--depth=1", "origin", base]);
  const diff =
    fetched.status === 0
      ? git(["diff", "--name-only", "--relative", base, "HEAD", "--", "."])
      : fetched;
  if (diff.status !== 0) {
    console.log(`Auswahl nicht möglich (${diff.stderr.trim()}): alle Stories.`);
    run(["run", ...config]);
  }

  const changed = diff.stdout.split("\n").filter(Boolean);
  if (changed.length === 0) {
    console.log("Keine Änderung unter frontend/: keine Story betroffen.");
    process.exit(0);
  }
  if (needsFullRun(changed)) {
    console.log("Globale Eingabe aller Stories geändert: alle Stories.");
    run(["run", ...config]);
  }
  console.log(`${changed.length} geänderte Dateien, betroffene Stories:`);
  // --passWithNoTests: eine Änderung ohne Story im Importgraphen ist kein Fehler.
  run(["related", "--run", "--passWithNoTests", ...config, ...changed]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
