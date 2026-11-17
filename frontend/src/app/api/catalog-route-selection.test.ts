import { readdirSync } from "node:fs";
import path from "node:path";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex";
import { getSortedRoutes } from "next/dist/shared/lib/router/utils/sorted-routes";
import { describe, expect, it } from "vitest";
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

const cases = Object.entries(portalRoutes).flatMap(([portal, routes]) => {
  const [mount, prefix] = BFF_PREFIX[portal as keyof typeof portalRoutes];
  return [...new Set(routes.map((route) => route.pattern))].map((pattern) => ({
    portal,
    // `/parent/me/x/{id}` → `/api/parent/me/x/{id}`, without a trailing slash.
    bff: (prefix + pattern.slice(mount.length)).replace(/\/$/, ""),
    catchAll: `${prefix}/[...path]`,
  }));
});

describe("route file in front of a portal's catalog proxy", () => {
  it.each(cases)(
    "$portal $bff is not shadowed by a dynamic route file",
    ({ bff, catchAll }) => {
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
