import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(
    new URL("../../.github/workflows/lint.yml", import.meta.url),
    "utf8",
  ),
);
const steps = workflow.jobs["frontend-quality"].steps;
const start = steps.find(
  (step) => step.name === "Start Chromium install for Storybook tests",
).run;
const wait = steps.find(
  (step) => step.name === "Wait for Chromium install",
).run;

for (const status of [0, 42]) {
  test(`Chromium install records and forwards exit status ${status} under bash -e`, () => {
    const directory = mkdtempSync(join(tmpdir(), "chromium-install-"));
    const options = {
      env: { ...process.env, RUNNER_TEMP: directory },
      encoding: "utf8",
      timeout: 5000,
    };
    try {
      const installed = spawnSync(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-e",
          "-o",
          "pipefail",
          "-c",
          `pnpm() { echo install-output; return ${status}; }\n${start}\nwait`,
        ],
        options,
      );
      assert.equal(installed.status, 0, installed.stderr);
      assert.equal(
        readFileSync(join(directory, "chromium-install.exit"), "utf8").trim(),
        String(status),
      );
      const completed = spawnSync(
        "bash",
        ["-e", "-o", "pipefail", "-c", wait],
        options,
      );
      assert.equal(completed.status, status, completed.stderr);
      assert.match(completed.stdout, /install-output/);
      assert.doesNotMatch(completed.stderr, /did not finish/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
