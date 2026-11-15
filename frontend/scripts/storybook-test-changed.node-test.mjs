// Auswahl der Storybook-Tests pro Pull Request (#7108): globale Eingaben
// starten den Vollauf, weil `vitest related` nur den Importen der Stories
// folgt und forceRerunTriggers dort nicht wirkt.
import assert from "node:assert/strict";
import { test } from "node:test";

import { needsFullRun } from "./storybook-test-changed.mjs";

test("a global input of every story starts the full run", () => {
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "vitest.storybook.config.ts",
    ".storybook/preview.tsx",
    "src/styles/globals.css",
    "src/app/providers.tsx",
    "src/lib/tenant-context.tsx",
    "src/components/notifications/notification-bridge.tsx",
    "src/contexts/ToastContext.tsx",
    "src/components/ui/overlay-stack.ts",
    "src/fonts/inter-latin-variable.woff2",
    "src/fonts/kalam-latin-700.woff2",
    "postcss.config.mjs",
    "tsconfig.json",
    "public/icons/logo.svg",
    "scripts/storybook-test-changed.mjs",
  ]) {
    assert.equal(needsFullRun([path]), true, path);
  }
});

test("component, story and copy changes keep the selection", () => {
  assert.equal(
    needsFullRun([
      "src/components/ui/stat-card.tsx",
      "src/components/ui/stat-card.stories.tsx",
      "src/i18n/messages/de/common.json",
      "src/app/[tenant]/(protected)/staff/page.tsx",
    ]),
    false,
  );
});
