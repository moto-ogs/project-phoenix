// Auswahl der Storybook-Tests pro Pull Request (#7108): globale Eingaben
// starten den Vollauf, weil `vitest related` nur den Importen der Stories
// folgt und forceRerunTriggers dort nicht wirkt.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

import {
  needsFullRun,
  runtimeImports,
  shardArgs,
} from "./storybook-test-changed.mjs";

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

test("type-only preview dependencies do not force every story to render", () => {
  const imports = runtimeImports(
    `import type * as Contract from "./generated";
     export type { Row } from "./model";
     import type { UI } from "./mixed";
     export { Button } from "./mixed";
     import { type Theme } from "./theme";
     import "./styles.css";
     const page = import("./page");`,
    "provider.tsx",
  );
  assert.deepEqual(imports, ["./mixed", "./theme", "./styles.css", "./page"]);
});

test("a shard passes through to Vitest, an invalid one stops the run", () => {
  assert.deepEqual(shardArgs(undefined), []);
  assert.deepEqual(shardArgs(""), []);
  assert.deepEqual(shardArgs("2/3"), ["--shard=2/3"]);
  for (const value of ["0/3", "4/3", "1", "a/b", "1/3/4"])
    assert.throws(() => shardArgs(value), /STORYBOOK_SHARD/, value);
});

test("the CI shards cover every story file exactly once", () => {
  const job = parse(
    readFileSync(
      new URL("../../.github/workflows/lint.yml", import.meta.url),
      "utf8",
    ),
  ).jobs["storybook-tests"];
  const shards = job.strategy.matrix.shard;
  const step = job.steps.find((s) => s.name === "Storybook tests (a11y)");
  assert.equal(
    step.env.STORYBOOK_SHARD,
    `\${{ matrix.shard }}/${shards.length}`,
  );
  assert.deepEqual(
    shards,
    shards.map((_, i) => i + 1),
  );
  assert.equal(
    job.name,
    `Storybook tests (\${{ matrix.shard }}/${shards.length})`,
  );
});
