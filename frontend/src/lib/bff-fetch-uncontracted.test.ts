// Every caller of bffJsonUncontracted, with the reason its BFF path has no
// Go contract (#7806). A path that gets a contract moves to bffJson and
// leaves this list; a new entry needs a named route.ts the contract cannot
// carry (docs/agents/new-route.md#when-a-route-needs-its-own-routets).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const UNCONTRACTED_CALLERS: Readonly<Record<string, string>> = {
  "lib/settings-api.ts":
    "PUT/DELETE settings/values/[key]: the route purges the cached tenant lookup",
};

const SRC = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe("bffJsonUncontracted", () => {
  it("is called only by the listed files", () => {
    const callers = sourceFiles(SRC)
      .filter((file) =>
        /bffJsonUncontracted[<(]/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(SRC, file))
      .filter((file) => file !== "lib/bff-fetch.ts")
      .sort();

    expect(callers).toEqual(Object.keys(UNCONTRACTED_CALLERS).sort());
  });
});
