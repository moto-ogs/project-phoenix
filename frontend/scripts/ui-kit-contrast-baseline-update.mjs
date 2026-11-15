#!/usr/bin/env node
// Schreibt scripts/ui-kit-contrast-baseline.json neu (#7108): Funde je Datei
// der Regeln ui-kit/no-gray-400-text und ui-kit/no-gray-400-focus-ring. Die
// Baseline darf nur sinken. `--check` schreibt nichts und meldet Abweichungen.
import { updateRatchetBaseline } from "./ui-kit-ratchet-baseline.mjs";

updateRatchetBaseline({
  rules: ["no-gray-400-text", "no-gray-400-focus-ring"],
  baselineFile: "ui-kit-contrast-baseline.json",
  pathEnv: "UI_KIT_CONTRAST_BASELINE_PATH",
  countEnv: "UI_KIT_CONTRAST_RATCHET",
  allowlist: [],
  command: "pnpm run ui-kit:contrast-baseline",
});
