import { defineConfig } from "@playwright/test";
import { SECURE_CHROME_SETUP, secureChromeUse } from "./scripts/secure-chrome";

// Barrierefreiheits-Audit (#2790, #7107): manuelles Werkzeug für Re-Audits,
// nie Teil der E2E-Suite oder von CI. Anleitung im Kopf von
// scripts/a11y-audit/scan.audit.ts. Kein webServer: Der Stack läuft schon
// (scripts/dev-native.sh up), geseedet mit dem Profil `vollbetrieb`.
/** @public Loaded by the Playwright CLI rather than imported by application code. */
export default defineConfig({
  globalSetup: SECURE_CHROME_SETUP,
  testDir: "./scripts/a11y-audit",
  testMatch: "*.audit.ts",
  // Ein Lauf prüft über hundert Ansichten nacheinander.
  timeout: 60 * 60_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/a11y-audit",
  use: {
    ...secureChromeUse(),
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
});
