// Auswahl der Storybook-Tests pro Pull Request (#7108): globale Eingaben
// starten den Vollauf, weil `vitest related` nur den Importen der Stories
// folgt und forceRerunTriggers dort nicht wirkt.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";

import {
  needsFullRun,
  planFor,
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

test("CI runs each selection on one runner or a complete matrix, never both", () => {
  const jobs = parse(
    readFileSync(
      new URL("../../.github/workflows/lint.yml", import.meta.url),
      "utf8",
    ),
  ).jobs;
  const primary = jobs["storybook-selected"];
  const parallel = jobs["storybook-tests"];
  const install = primary.steps.find(
    (step) => step.name === "Install Chromium",
  );
  const a11y = (job) =>
    job.steps.find((step) => step.name === "Storybook tests (a11y)");
  function check(scope, files, expected) {
    const { shards } = planFor(files);
    const outputs = {
      count: String(shards.length),
      shards: JSON.stringify(shards),
    };
    const context = {
      inputs: { "run-frontend": true, "storybook-mode": scope },
      steps: { select: { outputs } },
      needs: {
        "storybook-selected": {
          result: scope === "select" ? "success" : "skipped",
          outputs: scope === "select" ? outputs : {},
        },
      },
      cancelled: () => false,
      fromJSON: JSON.parse,
    };
    const evaluate = (source) =>
      runInNewContext(
        source
          .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
          .replace(/\.([\w]+(?:-[\w]+)+)/g, '["$1"]'),
        context,
      );
    const single = evaluate(primary.if) && evaluate(install.if);
    assert.equal(single, evaluate(primary.if) && evaluate(a11y(primary).if));
    const matrix = evaluate(parallel.if)
      ? evaluate(parallel.strategy.matrix.shard)
      : [];
    const runs = single ? ["single"] : [];
    for (const shard of matrix) {
      const value = a11y(parallel)
        .env.STORYBOOK_SHARD.replace("${{ matrix.shard }}", shard)
        .replace("${{ strategy.job-total }}", matrix.length);
      runs.push(...shardArgs(value));
    }
    assert.deepEqual(runs, expected);
  }
  check("skip", [], []);
  check("select", [], []);
  check("select", ["selected.stories.tsx"], ["single"]);
  check("select", Array(100).fill("story"), ["--shard=1/2", "--shard=2/2"]);
  const full = ["--shard=1/3", "--shard=2/3", "--shard=3/3"];
  check("select", Array(250).fill("story"), full);
  check("select", null, full);
  check("full", null, full);
});
