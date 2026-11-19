import { readdirSync } from "node:fs";
import path from "node:path";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex";
import { getSortedRoutes } from "next/dist/shared/lib/router/utils/sorted-routes";
import { describe, expect, it } from "vitest";
import {
  CATALOG_OUTSIDE_MOUNTS,
  CATALOG_PUBLIC_OUTSIDE_MOUNTS,
  underOutsideHead,
} from "~/lib/contract/catalog-outside-mounts";
import { portalRoutes } from "~/lib/contract/portals.generated";

/**
 * A registered route reaches its portal's catalog proxy only when no route
 * file with a dynamic segment stands in front of it: Next prefers
 * `billing-families/[id]` over `[...path]` for
 * `billing-families/debtor-number-format`, and that file would answer with
 * its own backend call (#2352). Such a route keeps a literal route file that
 * hands the request to the proxy.
 */

type SessionPortal = Exclude<keyof typeof portalRoutes, "public">;

/** The BFF prefix that stands for each portal's backend mount. */
const BFF_PREFIX: Record<SessionPortal, [string, string]> = {
  tenant: ["/api", "/api"],
  parent: ["/parent", "/api/parent"],
  school: ["/school", "/api/school"],
  org: ["/traeger", "/api/traeger"],
  caterer: ["/caterer", "/api/caterer"],
  platform: ["/operator", "/api/operator"],
};

/**
 * Literal route files that hand a path Next would give another file to a
 * portal's catalog proxy: `/api/auth/…` belongs to Auth.js otherwise.
 */
const HAND_OFFS: Record<string, SessionPortal> = {
  "/api/auth/invitations/[[...path]]": "tenant",
  "/api/auth/roles/[[...path]]": "tenant",
  "/api/auth/permissions/[[...path]]": "tenant",
  "/api/auth/accounts/[accountId]/[...path]": "tenant",
  "/api/auth/mfa/trusted-devices/[[...path]]": "tenant",
  "/api/auth/passkeys/[[...path]]": "tenant",
  "/api/auth/account/[...path]": "tenant",
  "/api/auth/link-to-tenant/[[...path]]": "tenant",
  "/api/auth/register/[[...path]]": "tenant",
  "/api/auth/staff-preview/[...path]": "tenant",
  "/api/auth/password-reset/[[...path]]": "tenant",
  "/api/auth/password/[[...path]]": "tenant",
  "/api/caterer/auth/mfa/trusted-devices/[[...path]]": "caterer",
  "/api/caterer/auth/passkeys/[[...path]]": "caterer",
  "/api/caterer/auth/password-reset/[[...path]]": "caterer",
  "/api/parent/auth/password-reset/[[...path]]": "parent",
  "/api/school/auth/mfa/[...path]": "school",
  "/api/school/auth/password-reset/[[...path]]": "school",
  "/api/traeger/auth/mfa/[...path]": "org",
  "/api/traeger/auth/password-reset/[[...path]]": "org",
  "/api/operator/auth/email-confirm/[[...path]]": "platform",
  "/api/operator/auth/mfa/[...path]": "platform",
  "/api/operator/auth/passkeys/[[...path]]": "platform",
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

const segmentsOf = (pattern: string) => pattern.split("/").filter(Boolean);

/**
 * The BFF path of a pattern: `/parent/me/x/{id}` → `/api/parent/me/x/{id}`;
 * a pattern beside the mount that the portal's outside list names keeps its
 * whole path under the prefix: `/analytics-policy` →
 * `/api/school/analytics-policy`. Null for a pattern no BFF path reaches.
 */
function bffPath(
  portal: SessionPortal,
  pattern: string,
  outside: readonly string[],
) {
  const [mount, prefix] = BFF_PREFIX[portal];
  if (startsWithHead(pattern, mount)) {
    return prefix + pattern.slice(mount.length);
  }
  return outside.some((head) => underOutsideHead(segmentsOf(pattern), head))
    ? prefix + pattern
    : null;
}

const publicOutside: Partial<Record<SessionPortal, readonly string[]>> =
  CATALOG_PUBLIC_OUTSIDE_MOUNTS;

/**
 * A public route is served by the catch-all of the portal whose mount, or
 * whose public list of heads beside it, the pattern starts with.
 */
function publicPortalOf(pattern: string): SessionPortal | null {
  const portals = Object.keys(BFF_PREFIX) as SessionPortal[];
  return (
    portals.find((portal) => startsWithHead(pattern, BFF_PREFIX[portal][0])) ??
    portals.find((portal) =>
      (publicOutside[portal] ?? []).some((head) =>
        underOutsideHead(segmentsOf(pattern), head),
      ),
    ) ??
    null
  );
}

const cases = Object.entries(portalRoutes).flatMap(([name, routes]) =>
  [...new Set(routes.map((route) => route.pattern))].map((pattern) => {
    const portal =
      name === "public" ? publicPortalOf(pattern) : (name as SessionPortal);
    const outside: readonly string[] =
      portal === null
        ? []
        : name === "public"
          ? (publicOutside[portal] ?? [])
          : CATALOG_OUTSIDE_MOUNTS[portal];
    return {
      portal: name,
      pattern,
      // Without a trailing slash, as the browser calls it.
      bff:
        portal === null
          ? null
          : (bffPath(portal, pattern, outside)?.replace(/\/$/, "") ?? null),
      catchAlls:
        portal === null
          ? []
          : [
              `${BFF_PREFIX[portal][1]}/[...path]`,
              ...Object.keys(HAND_OFFS).filter(
                (file) => HAND_OFFS[file] === portal,
              ),
            ],
    };
  }),
);

describe("registered route beside a portal's mount", () => {
  it.each(cases)("$portal $pattern has a BFF path", ({ portal, bff }) => {
    // A pattern outside the mount needs an entry in
    // lib/contract/catalog-outside-mounts.ts, or the proxy never reaches it:
    // a public route in CATALOG_PUBLIC_OUTSIDE_MOUNTS, a session route in
    // CATALOG_OUTSIDE_MOUNTS.
    const list =
      portal === "public"
        ? "CATALOG_PUBLIC_OUTSIDE_MOUNTS"
        : "CATALOG_OUTSIDE_MOUNTS";
    expect(
      bff,
      `no portal's proxy reaches this route; name its head in ${list}`,
    ).not.toBeNull();
  });

  it("names only heads the contract registers for the portal", () => {
    const lists = [
      ...Object.entries(CATALOG_OUTSIDE_MOUNTS),
      ...Object.values(CATALOG_PUBLIC_OUTSIDE_MOUNTS).map(
        (heads) => ["public", heads] as const,
      ),
    ];
    for (const [name, heads] of lists) {
      const patterns = portalRoutes[name as keyof typeof portalRoutes].map(
        (route) => route.pattern,
      );
      for (const head of heads) {
        expect(
          patterns.some((pattern) =>
            underOutsideHead(segmentsOf(pattern), head),
          ),
          `${name} ${head}`,
        ).toBe(true);
      }
    }
  });
});

describe("route file in front of a portal's catalog proxy", () => {
  it.each(cases)(
    "$portal $bff is not shadowed by a dynamic route file",
    ({ bff, catchAlls }) => {
      if (bff === null) return;
      const pattern = bff.split("/");
      const sample = pattern
        .map((segment) => (isParam(segment) ? "1" : segment))
        .join("/");
      const selected = routeFiles.find(({ match }) => match(sample))?.route;
      expect(selected).toBeDefined();
      if (catchAlls.includes(selected!)) return;
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

/**
 * Paths whose own route file is gone (#2352, #7563): Next must hand them to
 * the portal's catch-all, not to a dynamic neighbour or Auth.js. Before,
 * `time-tracking/[id]` caught `time-tracking/current` and literal hand-off
 * files had to stand beside it.
 */
describe("path freed from its own route file", () => {
  it.each([
    ["/api/time-tracking/current", "/api/[...path]"],
    ["/api/time-tracking/check-in", "/api/[...path]"],
    ["/api/time-tracking/month-summary", "/api/[...path]"],
    ["/api/time-tracking/1", "/api/[...path]"],
    ["/api/users/1", "/api/[...path]"],
    ["/api/substitutions", "/api/[...path]"],
    ["/api/enrollment/legal/schule", "/api/[...path]"],
    ["/api/enrollment/legal/schule/1", "/api/[...path]"],
    ["/api/staff/shifts/overview", "/api/[...path]"],
    ["/api/timetable/conflict-check", "/api/[...path]"],
    [
      "/api/traeger/billing-families/debtor-number-format",
      "/api/traeger/billing-families/debtor-number-format",
    ],
    ["/api/operator/schools/1/pwa-usage", "/api/operator/[...path]"],
    ["/api/parent/me/calendar", "/api/parent/[...path]"],
    // Former temporary route files of the previous bundle (#2352, #7563).
    ["/api/students", "/api/[...path]"],
    ["/api/students/1", "/api/[...path]"],
    ["/api/students/change-requests", "/api/[...path]"],
    ["/api/students/day-log", "/api/[...path]"],
    ["/api/students/ogs-group-live", "/api/[...path]"],
    ["/api/students/1/documents", "/api/students/[id]/documents"],
    ["/api/staff/1", "/api/[...path]"],
    ["/api/staff/by-role", "/api/[...path]"],
    ["/api/staff/qualification-types", "/api/[...path]"],
    ["/api/rooms/1", "/api/[...path]"],
    ["/api/rooms/by-category", "/api/[...path]"],
    ["/api/activities/1", "/api/[...path]"],
    ["/api/activities/quick-create", "/api/[...path]"],
    ["/api/iot/device-slots", "/api/[...path]"],
    ["/api/search", "/api/[...path]"],
    // A list on the bare path reaches the portal's proxy, not Auth.js.
    ["/api/auth/passkeys", "/api/auth/passkeys/[[...path]]"],
    ["/api/auth/passkeys/register/options", "/api/auth/passkeys/[[...path]]"],
    [
      "/api/auth/mfa/trusted-devices",
      "/api/auth/mfa/trusted-devices/[[...path]]",
    ],
    ["/api/auth/password", "/api/auth/password/[[...path]]"],
    ["/api/auth/accounts/1/mfa", "/api/auth/accounts/[accountId]/[...path]"],
    [
      "/api/caterer/auth/mfa/trusted-devices",
      "/api/caterer/auth/mfa/trusted-devices/[[...path]]",
    ],
    ["/api/caterer/auth/passkeys", "/api/caterer/auth/passkeys/[[...path]]"],
    ["/api/caterer/account/password", "/api/caterer/[...path]"],
    ["/api/caterer/account/mfa/disable", "/api/caterer/[...path]"],
    ["/api/operator/auth/passkeys", "/api/operator/auth/passkeys/[[...path]]"],
    ["/api/operator/profile/password", "/api/operator/[...path]"],
    ["/api/school/auth/mfa/trusted-devices", "/api/school/auth/mfa/[...path]"],
    [
      "/api/traeger/auth/mfa/trusted-devices",
      "/api/traeger/auth/mfa/[...path]",
    ],
    ["/api/parent/me/mfa", "/api/parent/[...path]"],
    ["/api/parent/me/children/1/sick-note", "/api/parent/[...path]"],
  ])("%s goes to %s", (sample, expected) => {
    expect(routeFiles.find(({ match }) => match(sample))?.route).toBe(expected);
  });
});
