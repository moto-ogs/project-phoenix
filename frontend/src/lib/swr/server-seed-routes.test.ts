import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

const sourceRoot = resolve(import.meta.dirname, "../..");

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
      join(sourceRoot, "app/[tenant]/(protected)", route, "page.tsx"),
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
    expect(existsSync(join(sourceRoot, file)), file).toBe(false);
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
    const files = readdirSync(join(sourceRoot, directory), {
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
      const path = join(file.parentPath, file.name);
      const source = readFileSync(path, "utf8");
      for (const route of openingOnly) {
        if (source.includes(JSON.stringify(route))) {
          violations.push(`${relative(sourceRoot, path)}: ${route}`);
        }
      }
    }
  }

  expect(violations).toEqual([]);
});
