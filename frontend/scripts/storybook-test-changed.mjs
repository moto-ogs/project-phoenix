#!/usr/bin/env node
// Storybook-Tests in CI (#7108): jede Story im Browser, mit axe-Prüfung.
// Der Vollauf kostet mehrere Minuten; ein Pull Request prüft deshalb nur die
// Stories, deren Importe er ändert (`vitest related`). Ohne BASE_SHA (Push,
// nightly), bei einer globalen Eingabe aller Stories oder wenn die Auswahl
// scheitert, läuft alles: die Auswahl schlägt offen fehl.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

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
  /^src\/fonts\//,
  /^postcss\.config\.mjs$/,
  /^tsconfig\.json$/,
  /^public\//,
];

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let previewInputs;

// Nicht nur die Provider selbst, sondern auch ihre lokalen Importe wirken
// auf jede Story. TypeScripts Resolver berücksichtigt die tsconfig-Aliase.
function globalPreviewInputs() {
  const config = ts.readConfigFile(
    resolve(frontend, "tsconfig.json"),
    ts.sys.readFile,
  );
  if (config.error) throw new Error("tsconfig.json nicht lesbar");
  const { options, errors } = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    frontend,
  );
  if (errors.length) throw new Error("tsconfig.json nicht auswertbar");
  const inputs = new Set();
  function visit(file) {
    const path = relative(frontend, file).split("\\").join("/");
    // Bewusste Ausnahme für Texte, siehe oben.
    if (inputs.has(path) || path.startsWith("src/i18n/messages/")) return;
    inputs.add(path);
    const source = /\.(css|[cm]?[jt]sx?)$/.test(file)
      ? readFileSync(file, "utf8")
      : "";
    const imports = file.endsWith(".css")
      ? [
          ...source.matchAll(/(?:@import\s+["']|url\(\s*["']?)([^"'\s)]+)/g),
        ].map((match) => match[1])
      : ts
          .preProcessFile(source, true, true)
          .importedFiles.map((imported) => imported.fileName);
    for (const fileName of imports) {
      if (!/^(\.|~\/|@\/|~storybook\/)/.test(fileName)) continue;
      // CSS und Schriftdateien löst TypeScript nicht als Module auf.
      const asset = fileName.startsWith(".")
        ? resolve(dirname(file), fileName)
        : resolve(
            frontend,
            fileName
              .replace(/^(~|@)\//, "src/")
              .replace(/^~storybook\//, ".storybook/"),
          );
      if (existsSync(asset) && statSync(asset).isFile()) {
        visit(asset);
        continue;
      }
      const { resolvedModule } = ts.resolveModuleName(
        fileName,
        file,
        options,
        ts.sys,
      );
      if (!resolvedModule)
        throw new Error(`Import nicht auflösbar: ${fileName} in ${path}`);
      visit(resolvedModule.resolvedFileName);
    }
  }
  visit(resolve(frontend, ".storybook/preview.tsx"));
  return inputs;
}

/** Pfade relativ zu frontend/. */
export function needsFullRun(changed) {
  if (changed.some((path) => GLOBAL_INPUTS.some((re) => re.test(path))))
    return true;
  try {
    previewInputs ??= globalPreviewInputs();
    return changed.some((path) => previewInputs.has(path));
  } catch (error) {
    console.log(
      `Preview-Importgraph nicht auswertbar (${error.message}): alle Stories.`,
    );
    return true;
  }
}

/**
 * CI verteilt die Story-Dateien auf mehrere Runner (STORYBOOK_SHARD=1/3);
 * ein ungültiger Wert bricht ab, statt still alle oder keine zu prüfen.
 */
export function shardArgs(value) {
  const shard = value?.trim();
  if (!shard) return [];
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const [index, count] = match ? [Number(match[1]), Number(match[2])] : [];
  if (!match || index < 1 || index > count)
    throw new Error(`STORYBOOK_SHARD ungültig: ${shard}`);
  return [`--shard=${index}/${count}`];
}

const config = [
  "-c",
  "vitest.storybook.config.ts",
  ...shardArgs(process.env.STORYBOOK_SHARD),
];

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
