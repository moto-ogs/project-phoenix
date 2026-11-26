import { defineConfig, devices } from "@playwright/test";
import { SECURE_CHROME_SETUP, secureChromeUse } from "./scripts/secure-chrome";

// The same local production build is measured across portals. Start it
// explicitly before running this spec so a second build cannot warm or replace it.
export default defineConfig({
  globalSetup: SECURE_CHROME_SETUP,
  testDir: "./scripts/perf",
  testMatch: "server-seed.perf.ts",
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: "list",
  outputDir: "perf-results/server-seed/test-output",
  use: {
    ...devices["Desktop Chrome"],
    ...secureChromeUse(),
  },
});
