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

it("lists every page exactly once in the server-seed inventories", () => {
  const appRoot = path.join(sourceRoot, "app");
  const pages = readdirSync(appRoot, { recursive: true, withFileTypes: true })
    .filter((file) => file.isFile() && file.name === "page.tsx")
    .map((file) => path.relative(appRoot, file.parentPath).split(path.sep))
    // Parallel slots reuse a canonical route; groups do not appear in it.
    .filter((segments) => !segments.some((segment) => segment.startsWith("@")))
    .map(
      (segments) =>
        `/${segments.filter((segment) => !segment.startsWith("(")).join("/")}`,
    );

  const inventories = [
    ["server-seed-team.md", "/[tenant]"],
    ["server-seed-team-catalog.md", "/[tenant]"],
    ["server-seed-parents-public.md", "/"],
    ["server-seed-portals.md", "/"],
  ] as const;
  const listed: string[] = [];
  for (const [name, defaultPrefix] of inventories) {
    const file = path.resolve(sourceRoot, "../../docs/agents", name);
    let prefix: string = defaultPrefix;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const section = /^\| Route under `([^`]+)` \|/.exec(line)?.[1];
      if (section) prefix = section;
      const route = /^\| `([^\s`]+)` \|/.exec(line)?.[1];
      if (!route || route.startsWith("@") || route.endsWith(".tsx")) continue;
      listed.push(path.posix.join(prefix, route).replace(/\/$/, "") || "/");
    }
  }

  expect(listed.sort(), "Update docs/agents/server-seed-*.md").toEqual(
    pages.sort(),
  );
});

// These first displays are the rollout's critical paths. Their client
// readers remain the recovery path, but cannot own the initial request again.
const seededEntrypoints = [
  ["[tenant]/(protected)/home", "HomeSeed"],
  ["[tenant]/(protected)/students/search", "StudentSearchSeed"],
  ["[tenant]/(protected)/active-supervisions", "ActiveSupervisionsSeed"],
  ["[tenant]/(protected)/anfragen", "AnfragenSeed"],
  ["[tenant]/(protected)/time-tracking", "TimeTrackingSeed"],
  ["school/tagesinformationen", "SWRServerSeed"],
  ["traeger", "SWRServerSeed"],
  ["operator/organizations", "SWRServerSeed"],
  ["caterer", "SWRServerSeed"],
] as const;

it.each(seededEntrypoints)(
  "starts %s through its server seed",
  (route, boundary) => {
    const source = readFileSync(
      path.join(sourceRoot, "app", route, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^["']use client["']/);
    expect(source).toContain(`<${boundary} `);
  },
);

it("starts parents through its server seed", () => {
  const parents = path.join(sourceRoot, "app", "parents");
  const page = readFileSync(path.join(parents, "page.tsx"), "utf8");
  expect(page).not.toMatch(/^["']use client["']/);
  if (page.includes("<ParentPageSeed ")) {
    const wrapper = readFileSync(
      path.join(parents, "parent-page-seed.tsx"),
      "utf8",
    );
    expect(wrapper).toContain("<ParentServerSeed ");
  } else {
    expect(page).toContain("<ParentServerSeed ");
  }
});

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
  // Read trails, mark-as-read, and GETs that can change backend state.
  const openingOnly = [
    "GET /api/students/{id}",
    "GET /api/students/day-log",
    "GET /api/statistics/report",
    "GET /api/week-protocols/{protocolId}",
    "GET /api/enrollment/admin/requests/{id}/",
    "GET /api/messages/threads/{threadId}",
    "GET /api/staff-messages/threads/{threadID}",
    "GET /api/staff/documents-directory",
    "GET /api/staff/{id}/qualifications",
    "GET /api/staff/me/qualifications",
    "GET /api/staff/qualifications",
    "GET /api/staff/qualification-types",
    "GET /api/staff/{id}/stammdaten",
    "GET /api/staff/{id}/stammdaten/bank-steuer",
    "GET /parent/me/messages/children/{studentId}",
    "GET /parent/me/messages/group-threads/{groupThreadId}",
    "GET /parent/me/documents",
    "GET /parent/me/documents/contracts",
    "GET /traeger/master-data/",
    "GET /traeger/master-data/responsibilities",
    "GET /traeger/holiday-periods/{id}/places",
    "GET /traeger/schools/children",
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
      const filePath = path.join(file.parentPath, file.name);
      const source = readFileSync(filePath, "utf8");
      for (const route of openingOnly) {
        if (source.includes(JSON.stringify(route))) {
          violations.push(`${path.relative(sourceRoot, filePath)}: ${route}`);
        }
      }
    }
  }

  expect(violations).toEqual([]);
});
