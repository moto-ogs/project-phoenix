import { defineConfig, devices } from "@playwright/test";

import { frontendPort } from "./e2e/frontend-port";
import { assertPortServesThisCheckout } from "./e2e/own-server";
import { printedGuides } from "./scripts/printed-guides";
import { SECURE_CHROME_SETUP, secureChromeUse } from "./scripts/secure-chrome";

assertPortServesThisCheckout(frontendPort);

const pages = printedGuides
  .map(({ route }) => `app${route}/page.tsx`)
  .join(",");
const guideBuild = `pnpm run build --debug-build-paths=${pages}`;
// Compile and prerender just the printed page. The image build typechecks the
// entire app; local generation must leave a complete .next for the developer.
const buildCommand = process.env.CI
  ? `${guideBuild} --experimental-build-mode=compile && ${guideBuild} --experimental-build-mode=generate`
  : "pnpm run build";

export default defineConfig({
  globalSetup: SECURE_CHROME_SETUP,
  testDir: "./scripts",
  testMatch: "generate-guides.ts",
  // A production build plus one render still needs more than Playwright's
  // 30-second default on CI.
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  use: {
    ...secureChromeUse(),
    baseURL: `http://localhost:${frontendPort}`,
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `${buildCommand} && pnpm run start`,
    url: `http://localhost:${frontendPort}${printedGuides[0].route}`,
    // Locally reuse a server you already have running; in CI always build fresh.
    reuseExistingServer: !process.env.CI,
    // Local generation can still need a cold build of the whole application.
    timeout: 600_000,
    stdout: "pipe",
  },
});
