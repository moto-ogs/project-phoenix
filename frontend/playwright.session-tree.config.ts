import { defineConfig } from "@playwright/test";
import network from "./playwright.network.config";
import { networkPorts } from "./e2e/network/ports.mjs";
import { secureChromeUse } from "./scripts/secure-chrome";

const ports = networkPorts("sessionTree");

/**
 * @public The portals' session boundary (#8082) in a production build:
 * real Auth.js domain cookies and UI, two tabs, synthetic localhost backend.
 * Chrome keeps its back-forward cache, which Playwright switches off by
 * default, so a restored page shows the real `pageshow.persisted` path.
 */
export default defineConfig({
  ...network,
  testDir: "./e2e/network",
  testMatch: "session-tree.spec.ts",
  testIgnore: [],
  outputDir: "test-results/session-tree",
  use: {
    ...network.use,
    ...secureChromeUse({
      args: [
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost",
        "--disable-background-networking",
      ],
      ignoreDefaultArgs: ["--disable-back-forward-cache"],
    }),
  },
  webServer: {
    url: `http://127.0.0.1:${ports.frontend}/school-a`,
    // A cold production build of the whole app.
    timeout: 900_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    stdout: "ignore",
    // The server writes only its own start errors; Next's output stays off.
    stderr: "pipe",
    command:
      "SESSION_TREE_EVIDENCE=1 node e2e/network/server.mjs --stop-with-stdin",
  },
});
