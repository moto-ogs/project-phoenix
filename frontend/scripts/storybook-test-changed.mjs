#!/usr/bin/env node
// Storybook-Tests in CI (#7108): jede Story im Browser, mit axe-Prüfung.
// Der Vollauf kostet mehrere Minuten; ein Pull Request prüft deshalb nur die
// Stories, deren Importe er ändert (`vitest related`). Was alle Stories
// betrifft, löst über forceRerunTriggers in vitest.storybook.config.ts den
// Vollauf aus. Ohne BASE_SHA (Push, nightly) oder wenn die Auswahl scheitert,
// läuft alles: die Auswahl schlägt offen fehl.
import { spawnSync } from "node:child_process";

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
console.log(`${changed.length} geänderte Dateien, betroffene Stories:`);
// --passWithNoTests: eine Änderung ohne Story im Importgraphen ist kein Fehler.
run(["related", "--run", "--passWithNoTests", ...config, ...changed]);
