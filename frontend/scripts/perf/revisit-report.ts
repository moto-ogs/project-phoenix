import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { median, OUT_DIR, REPEATS } from "./navigation-probe";
import type { RevisitRole } from "./revisit-access";
import type { measurePermissionChange } from "./revisit-permission";
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
  startIdlePercent: number;
  protocol: string;
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
  metadata: {
    revision: string;
    development: string;
    started: string;
    browser: string;
    platform: string;
    architecture: string;
    cpu?: string;
    cores: number;
    cpuThrottle: number;
    rttMs: number;
    desktopMbit: number;
    mobileMbit: number;
  },
  switches: Switch[],
  results: Observation[],
  permission: Awaited<ReturnType<typeof measurePermissionChange>>,
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
    "development@" +
      metadata.development +
      " · Harness " +
      metadata.revision +
      " · " +
      metadata.started +
      " · Chromium " +
      metadata.browser +
      ` · ${metadata.platform}/${metadata.architecture}, ${metadata.cpu ?? "CPU unbekannt"} (${metadata.cores} logische CPUs)`,
    "",
    `CPU ×${metadata.cpuThrottle}, ${metadata.rttMs} ms RTT, Desktop ${metadata.desktopMbit} Mbit/s, Pixel 7 ${metadata.mobileMbit} Mbit/s. Abweichungen: „nah“ = Median 130–170 ms; „Last“ = mindestens ein Durchgang im Mittel unter 50 % freier Host-CPU. Kein kausaler Vergleich bei unterschiedlicher Last.`,
    "",
    "Millisekunden: Median [Minimum–Maximum] aus drei Läufen. Ziel: je gültigem warmen bzw. Rückweg-Median < 150 ms. · = kein solcher History-Weg. Pro Zelle folgen RSC/JS/BFF (jeweils Median) und die tatsächlich sichtbaren Ladeanzeigen dieser Richtung. Einzelwerte und Ladeanzeigen je Lauf stehen im JSON.",
    "",
    "| Portal/Rolle | Ablauf | Profil/Eingabe | Erstbesuch | Warm 1 | Zurück 1 | Warm 4 | Zurück 4 | Inhaltskriterium |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const summary = [];
  for (const group of rows.values()) {
    const first = group[0]!;
    const cells = [];
    for (const step of steps) {
      const runs = group.filter((r) => r.step === step);
      const ms = runs.map((r) => r.ms);
      if (!runs.length) {
        cells.push("·");
        continue;
      }
      if (new Set(runs.map((r) => r.repeat)).size !== REPEATS)
        throw new Error("Unvollständige Serie: " + first.name + "/" + step);
      const net = (["rsc", "scripts", "api"] as const)
        .map((k) => median(runs.map((r) => r[k])))
        .join("/");
      const loading =
        [...new Set(runs.flatMap((r) => r.loading))].join(", ") || "keine";
      const nearBudget =
        step !== "kalt" && median(ms) >= 130 && median(ms) <= 170;
      const loadNote = runs.some((r) => r.idlePercent < 50) ? " · Last" : "";
      cells.push(
        interval(ms) +
          (nearBudget ? " · nah" : "") +
          loadNote +
          "<br>" +
          net +
          " · " +
          loading,
      );
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
    lines.push(
      "| " +
        [
          first.role,
          first.name,
          first.profile + "/" + first.input,
          ...cells,
          first.criterion,
        ].join(" | ") +
        " |",
    );
  }
  lines.push("", "## Gültige Mediane unter 150 ms", "");
  for (const step of steps.filter((s) => s !== "kalt")) {
    const eligible = summary.filter((row) => row.step === step);
    lines.push(
      `- ${step}: ${eligible.filter((row) => row.median < 150).length}/${eligible.length}`,
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
  if (permission.length) {
    lines.push(
      "",
      "| Elternprofil | Nach Rechteentzug: erlaubte Familienübersicht |",
      "|---|---:|",
    );
    for (const profile of new Set(permission.map((s) => s.profile)))
      lines.push(
        "| " +
          profile +
          " | " +
          interval(
            permission.filter((s) => s.profile === profile).map((s) => s.ms),
          ) +
          " |",
      );
  }
  writeFileSync(
    join(OUT_DIR, "revisit.summary.json"),
    "[\n" + summary.map((row) => JSON.stringify(row)).join(",\n") + "\n]\n",
  );
  writeFileSync(join(OUT_DIR, "revisit.md"), lines.join("\n") + "\n");
}
