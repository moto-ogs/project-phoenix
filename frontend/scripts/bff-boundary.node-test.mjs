import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";

import { RAW_TRANSPORT, UNCONTRACTED } from "./oxlint-plugin-bff-boundary.mjs";

test("browser BFF exceptions still point to existing source files", () => {
  const missing = [
    ...Object.keys(RAW_TRANSPORT),
    ...Object.keys(UNCONTRACTED),
  ].filter(
    (file) =>
      !statSync(new URL(`../src/${file}`, import.meta.url), {
        throwIfNoEntry: false,
      })?.isFile(),
  );
  assert.deepEqual(
    missing,
    [],
    "Remove exceptions for renamed or deleted files",
  );
});
