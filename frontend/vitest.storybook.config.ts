import path from "node:path";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Jede Story als Test im echten Chromium, mit der Barrierefreiheitsprüfung
// des a11y-Addons (#7108). Getrennt von vitest.config.ts: die Unit-Suite
// läuft in happy-dom und bleibt davon unberührt. Start: `pnpm run
// test:storybook`; in CI im Job „Frontend quality“ nach dem Storybook-Build.
const configDir = path.join(import.meta.dirname, ".storybook");

/** @public Loaded by the Vitest CLI rather than imported by application code. */
export default defineConfig({
  plugins: [storybookTest({ configDir })],
  test: {
    name: "storybook",
    // `vitest related` (CI-Auswahl pro PR, scripts/storybook-test-changed.mjs)
    // folgt nur den Importen der Stories. Was alle Stories betrifft, ohne
    // dass eine es importiert, startet den Vollauf: Storybook-Konfiguration,
    // globale Styles, Abhängigkeiten und diese Datei.
    forceRerunTriggers: [
      "**/package.json/**",
      "**/pnpm-lock.yaml/**",
      "**/vitest.storybook.config.ts/**",
      "**/.storybook/**",
      "**/src/styles/**",
    ],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
