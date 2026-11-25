import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function collectDynamicSiblingConflicts(
  directory: string,
  appRoot = directory,
): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const dynamicDirectories = directories
    .filter((entry) => entry.name.startsWith("[") && entry.name.endsWith("]"))
    .map((entry) => entry.name)
    .sort();
  const conflicts =
    dynamicDirectories.length > 1
      ? [
          `${path.relative(appRoot, directory) || "."}: ${dynamicDirectories.join(", ")}`,
        ]
      : [];

  for (const entry of directories) {
    conflicts.push(
      ...collectDynamicSiblingConflicts(
        path.join(directory, entry.name),
        appRoot,
      ),
    );
  }

  return conflicts;
}

describe("Next.js app route filesystem invariants", () => {
  it("uses at most one dynamic child directory per filesystem parent", () => {
    const appRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../app",
    );

    expect(collectDynamicSiblingConflicts(appRoot)).toEqual([]);
  });
});

const sourceRoot = path.resolve(import.meta.dirname, "..");

// These first displays are the rollout's critical paths. Their client
// readers remain the recovery path, but cannot own the initial request again.
const tenantEntrypoints = [
  ["home", "HomeSeed"],
  ["students/search", "StudentSearchSeed"],
  ["active-supervisions", "ActiveSupervisionsSeed"],
  ["anfragen", "AnfragenSeed"],
  ["time-tracking", "TimeTrackingSeed"],
] as const;

it.each(tenantEntrypoints)(
  "starts %s through its server seed",
  (route, boundary) => {
    const source = readFileSync(
      path.join(sourceRoot, "app/[tenant]/(protected)", route, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^["']use client["']/);
    expect(source).toContain(`<${boundary} `);
  },
);

it("does not restore the parallel browser route-prefetch path", () => {
  for (const file of [
    "components/tenant/tenant-data-prefetch.tsx",
    "components/tenant/resource-prefetch-provider.tsx",
    "components/tenant/tenant-prefetch-resources.ts",
    "components/ui/data-prefetch-intent.tsx",
  ]) {
    expect(existsSync(path.join(sourceRoot, file)), file).toBe(false);
  }
});

it("keeps known audit-producing and side-effecting GETs out of page and shell seeds", () => {
  // Read trails, mark-as-read, and deferred staff-document deletion.
  const openingOnly = [
    "GET /api/students/{id}",
    "GET /api/staff/documents-directory",
    "GET /parent/me/documents",
    "GET /parent/me/documents/contracts",
    "GET /traeger/master-data/",
    "GET /traeger/master-data/responsibilities",
    "GET /traeger/holiday-periods/{id}/places",
  ];
  const violations: string[] = [];

  for (const directory of ["app", "lib"]) {
    const files = readdirSync(path.join(sourceRoot, directory), {
      recursive: true,
      withFileTypes: true,
    });
    for (const file of files) {
      if (
        !file.isFile() ||
        !/^(?:page|layout)\.tsx$|(?:seed|bootstrap).*\.server\.ts$/.test(
          file.name,
        )
      ) {
        continue;
      }
      const path = path.join(file.parentPath, file.name);
      const source = readFileSync(path, "utf8");
      for (const route of openingOnly) {
        if (source.includes(JSON.stringify(route))) {
          violations.push(`${path.relative(sourceRoot, path)}: ${route}`);
        }
      }
    }
  }

  expect(violations).toEqual([]);
});
