import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

import { loadAccess, perfPort, tenantBaseUrl } from "./scripts/perf/access";
import { perfServerEnv } from "./scripts/perf/env.mjs";
import { SECURE_CHROME_SETUP, secureChromeUse } from "./scripts/secure-chrome";

// Seitenwechsel-Messung (pnpm run perf:nav, #2828). Gleicher Aufbau wie
// playwright.perf.config.ts — Produktions-Server, eigener Port, keine
// Wiederverwendung eines fremden Servers —, nur eine andere Testdatei:
// measure.perf.ts misst den kalten Aufruf, navigation.perf.ts den Wechsel
// zwischen zwei Seiten.
const env = perfServerEnv();
const access = loadAccess();

export default defineConfig({
  globalSetup: SECURE_CHROME_SETUP,
  testDir: "./scripts/perf",
  testMatch: "navigation.perf.ts",
  timeout: 900_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../tmp/perf-navigation-test-output",
  use: {
    ...devices["Desktop Chrome"],
    ...secureChromeUse(),
    baseURL: tenantBaseUrl(access),
    headless: true,
  },
  webServer: {
    command: existsSync(join(homedir(), "bin", "agent-heavy"))
      ? '"$HOME/bin/agent-heavy" -- pnpm run build && pnpm run start'
      : "pnpm run build && pnpm run start",
    env: { ...env, PORT: perfPort() },
    url: `http://localhost:${perfPort()}/help`,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
