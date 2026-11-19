import { readdirSync } from "node:fs";
import path from "node:path";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex";
import { getSortedRoutes } from "next/dist/shared/lib/router/utils/sorted-routes";
import { describe, expect, it } from "vitest";
import { CATALOG_OUTSIDE_MOUNTS } from "~/lib/contract/catalog-outside-mounts";
import { portalRoutes } from "~/lib/contract/portals.generated";

/**
 * A registered route reaches its portal's catalog proxy only when no route
 * file with a dynamic segment stands in front of it: Next prefers
 * `billing-families/[id]` over `[...path]` for
 * `billing-families/debtor-number-format`, and that file would answer with
 * its own backend call (#2352). Such a route keeps a literal route file that
 * hands the request to the proxy.
 */

/** The BFF prefix that stands for each portal's backend mount. */
const BFF_PREFIX: Record<keyof typeof portalRoutes, [string, string]> = {
  tenant: ["/api", "/api"],
  parent: ["/parent", "/api/parent"],
  school: ["/school", "/api/school"],
  org: ["/traeger", "/api/traeger"],
  caterer: ["/caterer", "/api/caterer"],
  platform: ["/operator", "/api/operator"],
};

const apiDir = path.dirname(new URL(import.meta.url).pathname);
const routeFiles = getSortedRoutes(
  readdirSync(apiDir, { recursive: true, encoding: "utf8" })
    .filter((file) => path.basename(file) === "route.ts")
    .map((file) =>
      ["/api", ...path.dirname(file).split(path.sep)]
        .filter((segment) => segment !== ".")
        .join("/"),
    ),
).map((route) => ({ route, match: getRouteMatcher(getRouteRegex(route)) }));

const isParam = (segment: string) => /^[[{]/.test(segment);

const startsWithHead = (pattern: string, head: string) =>
  pattern === head || pattern.startsWith(`${head}/`);

/**
 * The BFF path of a pattern: `/parent/me/x/{id}` → `/api/parent/me/x/{id}`;
 * a pattern beside the mount that the portal's outside list names keeps its
 * whole path under the prefix: `/analytics-policy` →
 * `/api/school/analytics-policy`. Null for a pattern no BFF path reaches.
 */
function bffPath(portal: keyof typeof portalRoutes, pattern: string) {
  const [mount, prefix] = BFF_PREFIX[portal];
  if (startsWithHead(pattern, mount)) {
    return prefix + pattern.slice(mount.length);
  }
  const outside: readonly string[] = CATALOG_OUTSIDE_MOUNTS[portal];
  return outside.some((head) => startsWithHead(pattern, head))
    ? prefix + pattern
    : null;
}

const cases = Object.entries(portalRoutes).flatMap(([name, routes]) => {
  const portal = name as keyof typeof portalRoutes;
  const [, prefix] = BFF_PREFIX[portal];
  return [...new Set(routes.map((route) => route.pattern))].map((pattern) => ({
    portal,
    pattern,
    // Without a trailing slash, as the browser calls it.
    bff: bffPath(portal, pattern)?.replace(/\/$/, "") ?? null,
    catchAll: `${prefix}/[...path]`,
  }));
});

describe("registered route beside a portal's mount", () => {
  it.each(cases)("$portal $pattern has a BFF path", ({ bff }) => {
    // A pattern outside the mount needs an entry in CATALOG_OUTSIDE_MOUNTS
    // (lib/contract/catalog-outside-mounts.ts), or the proxy never reaches it.
    expect(bff).not.toBeNull();
  });

  it("names only heads the contract registers for the portal", () => {
    for (const [name, heads] of Object.entries(CATALOG_OUTSIDE_MOUNTS)) {
      const patterns = portalRoutes[name as keyof typeof portalRoutes].map(
        (route) => route.pattern,
      );
      for (const head of heads) {
        expect(
          patterns.some((pattern) => startsWithHead(pattern, head)),
          `${name} ${head}`,
        ).toBe(true);
      }
    }
  });
});

describe("route file in front of a portal's catalog proxy", () => {
  it.each(cases)(
    "$portal $bff is not shadowed by a dynamic route file",
    ({ bff, catchAll }) => {
      if (bff === null) return;
      const pattern = bff.split("/");
      const sample = pattern
        .map((segment) => (isParam(segment) ? "1" : segment))
        .join("/");
      const selected = routeFiles.find(({ match }) => match(sample))?.route;
      expect(selected).toBeDefined();
      if (selected === catchAll) return;
      // A file of its own is fine while each of its dynamic segments stands
      // where the registered pattern has a parameter too.
      const shadowing = selected!
        .split("/")
        .filter(
          (segment, index) =>
            isParam(segment) && !isParam(pattern[index] ?? ""),
        );
      expect(shadowing, `${selected} answers ${sample}`).toEqual([]);
    },
  );
});
