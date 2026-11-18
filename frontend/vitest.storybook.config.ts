import path from "node:path";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { assertBrowserCanStart } from "./scripts/secure-chrome";

// Jede Story als Test im echten Chromium, mit der Barrierefreiheitsprüfung
// des a11y-Addons (#7108). Getrennt von vitest.config.ts: die Unit-Suite
// läuft in happy-dom und bleibt davon unberührt. Start: `pnpm run
// test:storybook`; in CI im Job „Frontend quality“ nach dem Storybook-Build.
const configDir = path.join(import.meta.dirname, ".storybook");

// Playwrights Chromium startet in der Codex-Sandbox auf macOS so wenig wie
// Google Chrome (`scripts/secure-chrome.ts`).
assertBrowserCanStart();

/** @public Loaded by the Vitest CLI rather than imported by application code. */
export default defineConfig({
  plugins: [storybookTest({ configDir })],
  test: {
    name: "storybook",
    // Ein String: das Storybook-Plugin übernimmt nur diese Form.
    setupFiles: path.join(configDir, "vitest.setup.ts"),
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
