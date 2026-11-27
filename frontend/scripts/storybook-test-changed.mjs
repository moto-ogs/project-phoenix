#!/usr/bin/env node
// Storybook-Tests in CI (#7108): jede Story im Browser, mit axe-Prüfung.
// Der Vollauf kostet mehrere Minuten; ein Pull Request prüft deshalb nur die
// Stories, deren Importe er ändert (`vitest related`). Ohne BASE_SHA (Push,
// nightly), bei einer globalen Eingabe aller Stories oder wenn die Auswahl
// scheitert, läuft alles: die Auswahl schlägt offen fehl.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
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

export function runtimeImports(source, file) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
  if (parsed.parseDiagnostics.length)
    throw new Error(`Quelldatei nicht lesbar: ${file}`);
  // Exclude only declarations erased in their entirety. With
  // verbatimModuleSyntax, `import { type T } from "./x"` still loads x.
  const typeOnly = new Set(
    parsed.statements
      .filter(
        (node) =>
          (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) ||
          (ts.isExportDeclaration(node) &&
            node.isTypeOnly &&
            node.moduleSpecifier),
      )
      .map((node) => node.moduleSpecifier.getStart(parsed)),
  );
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.filter((entry) => !typeOnly.has(entry.pos))
    .map((entry) => entry.fileName);
}

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
      : runtimeImports(source, file);
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

// One hosted shard rendered 96 files in 93–138 seconds (#8176, #8244).
// Keep small selections on this runner instead of repeating its setup twice.
export function planFor(files) {
  const count = files === null ? 3 : Math.min(3, Math.ceil(files.length / 64));
  return { files, shards: Array.from({ length: count }, (_, i) => i + 1) };
}

function changedFiles(base) {
  if (!base) return null;
  const options = { encoding: "utf8" };
  if (
    spawnSync("git", ["cat-file", "-e", `${base}^{commit}`], options).status !==
    0
  ) {
    // The name-only diff below reads the two trees, not their file contents.
    const fetched = spawnSync(
      "git",
      [
        "fetch",
        "--no-tags",
        "--depth=1",
        "--filter=blob:none",
        "--no-write-fetch-head",
        "origin",
        base,
      ],
      options,
    );
    if (fetched.status !== 0)
      throw new Error(fetched.stderr || "git fetch failed");
  }
  const diff = spawnSync(
    "git",
    [
      "diff",
      "--name-only",
      "--no-renames",
      "--relative",
      "-z",
      base,
      "HEAD",
      "--",
      ".",
    ],
    options,
  );
  if (diff.status !== 0) throw new Error(diff.stderr || "git diff failed");
  return diff.stdout.split("\0").filter(Boolean);
}

async function selectStories(changed) {
  if (changed === null) return null;
  if (!changed.length) return [];
  if (needsFullRun(changed)) return null;
  // Same module graph as `vitest related`, without collecting a story in the browser.
  // The Storybook addon installs its story matcher only in Vitest's CLI environment.
  process.env.VITEST = "true";
  process.env.TEST = "true";
  process.env.NODE_ENV ??= "test";
  const { createVitest } = await import("vitest/node");
  const vitest = await createVitest("test", {
    config: "vitest.storybook.config.ts",
    run: true,
    watch: false,
    related: changed.map((path) => resolve(frontend, path)),
  });
  try {
    const stories = await vitest.globTestSpecifications();
    if (
      !stories.length ||
      stories.some((spec) => !/\.stories\.tsx?$/.test(spec.moduleId))
    )
      throw new Error("Vitest hat keine gültige Storybook-Suite geladen");
    const specs = await vitest.getRelevantTestSpecifications();
    return specs.map(({ moduleId }) => relative(frontend, moduleId));
  } finally {
    await vitest.close();
  }
}

async function selection() {
  try {
    return await selectStories(changedFiles(process.env.BASE_SHA?.trim()));
  } catch (error) {
    console.warn(
      `Story-Auswahl nicht möglich (${error.message}): alle Stories.`,
    );
    return null;
  }
}

async function main() {
  if (process.argv.includes("--plan")) {
    const { shards, files } = planFor(await selection());
    console.log(
      files === null
        ? "Alle Stories."
        : `${files.length} betroffene Story-Dateien auf ${shards.length} Runnern.`,
    );
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `count=${shards.length}\nshards=${JSON.stringify(shards)}\nfiles=${JSON.stringify(files)}\n`,
    );
    return;
  }
  // In CI an omitted file list is an explicitly full run. Outside CI keep
  // the BASE_SHA entry point used to replay a pull request locally.
  const files = process.env.STORYBOOK_FILES
    ? JSON.parse(process.env.STORYBOOK_FILES)
    : await selection();
  if (files?.length === 0) return;
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "-c",
      "vitest.storybook.config.ts",
      ...shardArgs(process.env.STORYBOOK_SHARD),
      ...(files ?? []),
    ],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
