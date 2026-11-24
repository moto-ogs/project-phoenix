import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { median, OUT_DIR } from "./navigation-probe";
import type { RevisitRole } from "./revisit-access";
import type { measureParentSwitch } from "./revisit-context";

export type Step = "kalt" | "warm-1" | "zurück-1" | "warm-4" | "zurück-4";
export interface Observation {
  role: RevisitRole;
  name: string;
  profile: string;
  repeat: number;
  input: string;
  criterion: string;
  load: number[];
  idlePercent: number;
  step: Step;
  ms: number;
  rsc: number;
  scripts: number;
  api: number;
  documents: number;
  loading: string[];
}
type Switch = Awaited<ReturnType<typeof measureParentSwitch>>;

function interval(values: number[]) {
  return values.length
    ? median(values) +
        " [" +
        Math.min(...values) +
        "–" +
        Math.max(...values) +
        "]"
    : "·";
}

/** One observation per line keeps the evidence diffable without publishing request URLs or DOM text. */
export function saveObservations(
  metadata: object,
  switches: Switch[],
  results: Observation[],
) {
  writeFileSync(
    join(OUT_DIR, "revisit.json"),
    '{\n"metadata":' +
      JSON.stringify(metadata) +
      ',\n"switches":' +
      JSON.stringify(switches) +
      ',\n"results":[\n' +
      results.map((row) => JSON.stringify(row)).join(",\n") +
      "\n]}\n",
  );
}

export function writeReport(
  metadata: { revision: string; started: string; browser: string },
  switches: Switch[],
  results: Observation[],
) {
  const rows = new Map<string, Observation[]>();
  for (const r of results) {
    const key = [r.role, r.name, r.profile].join("/");
    const group = rows.get(key);
    if (group) group.push(r);
    else rows.set(key, [r]);
  }
  const steps: Step[] = ["kalt", "warm-1", "zurück-1", "warm-4", "zurück-4"];
  const lines = [
    "# Revisit: Fachinhalt nach Navigation",
    "",
    metadata.revision +
      " · " +
      metadata.started +
      " · Chromium " +
      metadata.browser,
    "",
    "Millisekunden: Median [Minimum–Maximum] aus drei Läufen. Ziel: je gültigem warmen bzw. Rückweg-Median < 150 ms. · = kein solcher History-Weg. Netzspalte: RSC/JS/BFF summiert über die tatsächlich gemessenen Schritte und Wiederholungen. Das JSON enthält die Zuordnung pro Einzellauf, auch unter 150 ms.",
    "",
    "| Portal/Rolle | Ablauf | Profil/Eingabe | Erstbesuch | Warm 1 | Zurück 1 | Warm 4 | Zurück 4 | RSC/JS/BFF | Sichtbare Ladezustände | Inhaltskriterium |",
    "|---|---|---|---:|---:|---:|---:|---:|---|---|---|",
  ];
  const summary = [];
  for (const group of rows.values()) {
    const first = group[0]!;
    const cells = [];
    for (const step of steps) {
      const runs = group.filter((r) => r.step === step);
      const ms = runs.map((r) => r.ms);
      cells.push(interval(ms));
      if (!runs.length) continue;
      summary.push({
        role: first.role,
        name: first.name,
        profile: first.profile,
        input: runs[0]!.input,
        step,
        median: median(ms),
        samples: ms,
        range: Math.max(...ms) - Math.min(...ms),
        rsc: runs.map((r) => r.rsc),
        js: runs.map((r) => r.scripts),
        bff: runs.map((r) => r.api),
        loading: runs.map((r) => r.loading),
        criterion: first.criterion,
      });
    }
    const net = (["rsc", "scripts", "api"] as const)
      .map((k) => group.reduce((a, r) => a + r[k], 0))
      .join("/");
    const states =
      [...new Set(group.flatMap((r) => r.loading))].join(", ") || "keine";
    lines.push(
      "| " +
        [
          first.role,
          first.name,
          first.profile + "/" + first.input,
          ...cells,
          net,
          states,
          first.criterion,
        ].join(" | ") +
        " |",
    );
  }
  if (switches.length) {
    lines.push(
      "",
      "## Getrennte Fälle",
      "",
      "Nicht im 150-ms-Budget. Im selben Browser wurde zuerst die bisherige Familie abgewiesen, dann die neue bestätigt.",
      "",
      "| Elternprofil | Abmeldung: bis Bestätigung | Ohne Sitzung: bis Anmeldung |",
      "|---|---:|---:|",
    );
    for (const profile of new Set(switches.map((s) => s.profile))) {
      const samples = switches.filter((s) => s.profile === profile);
      lines.push(
        "| " +
          profile +
          " | " +
          interval(samples.map((s) => s.confirmation.ms)) +
          " | " +
          interval(samples.map((s) => s.signedOut.ms)) +
          " |",
      );
    }
  }
  writeFileSync(
    join(OUT_DIR, "revisit.summary.json"),
    "[\n" + summary.map((row) => JSON.stringify(row)).join(",\n") + "\n]\n",
  );
  writeFileSync(join(OUT_DIR, "revisit.md"), lines.join("\n") + "\n");
}
