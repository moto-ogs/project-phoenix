import { readdirSync, readFileSync } from "node:fs";
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
 * file stands in front of it: Next would prefer a
 * `billing-families/[id]/route.ts` over `[...path]` for
 * `billing-families/debtor-number-format`, and that file would answer with
 * its own backend call (#2352). A path Next gives to Auth.js keeps a literal
 * hand-off file that passes the request to the proxy.
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

const apiDir = path.dirname(new URL(import.meta.url).pathname);
const routeFilePaths = readdirSync(apiDir, {
  recursive: true,
  encoding: "utf8",
}).filter((file) => path.basename(file) === "route.ts");

const bffRoute = (file: string) =>
  ["/api", ...path.dirname(file).split(path.sep)]
    .filter((segment) => segment !== ".")
    .join("/");

/**
 * Literal route files that hand a path Next would give another file to a
 * portal's catalog proxy: `/api/auth/…` belongs to Auth.js otherwise. A
 * hand-off is a route file that calls `catalogProxyUnder` with the portal's
 * routes; the file itself says in a comment why it stands there.
 */
const handOffFiles = routeFilePaths.flatMap((file) => {
  const source = readFileSync(path.join(apiDir, file), "utf8");
  if (!source.includes("catalogProxyUnder(")) return [];
  const portal = /portalRoutes\.(\w+)/.exec(source)?.[1] ?? "";
  return [{ route: bffRoute(file), portal, source }];
});

const HAND_OFFS: Record<string, SessionPortal> = Object.fromEntries(
  handOffFiles.map(({ route, portal }) => [route, portal as SessionPortal]),
);

const routeFiles = getSortedRoutes(routeFilePaths.map(bffRoute)).map(
  (route) => ({ route, match: getRouteMatcher(getRouteRegex(route)) }),
);

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

describe("hand-off route file", () => {
  it.each(handOffFiles)(
    "$route hands an Auth.js path to a session portal and says why",
    ({ route, portal, source }) => {
      expect(Object.keys(BFF_PREFIX)).toContain(portal);
      expect(route, "Next gives only /auth/ paths to Auth.js").toMatch(
        /\/auth\//,
      );
      expect(source, "a comment names why the file stands there").toMatch(
        /\/\*[\s\S]*?\*\/|^\s*\/\/ /m,
      );
    },
  );
});

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

/**
 * A path the contract registers reaches the portal's catalog proxy, never a
 * route file of its own (#2352, #2353): Next prefers a literal or dynamic
 * file over `[...path]`, and that file would answer with its own backend call
 * beside the contract, including a file answer or an upload that the proxy
 * streams private and uncached. The route file goes once its route is
 * registered; only the hand-off files above stand in front on purpose.
 */
describe("route file in front of a portal's catalog proxy", () => {
  it.each(cases)(
    "$portal $bff is not shadowed by a route file",
    ({ bff, catchAlls }) => {
      if (bff === null) return;
      const sample = bff
        .split("/")
        .map((segment) => (isParam(segment) ? "1" : segment))
        .join("/");
      const selected = routeFiles.find(({ match }) => match(sample))?.route;
      expect(catchAlls, `${selected} answers ${sample}`).toContain(selected);
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
    // Its hand-off file is gone: billing-families/[id] has no route file.
    [
      "/api/traeger/billing-families/debtor-number-format",
      "/api/traeger/[...path]",
    ],
    ["/api/operator/schools/1/pwa-usage", "/api/operator/[...path]"],
    ["/api/parent/me/calendar", "/api/parent/[...path]"],
    // Former temporary route files of the previous bundle (#2352, #7563).
    ["/api/students", "/api/[...path]"],
    ["/api/students/1", "/api/[...path]"],
    ["/api/students/change-requests", "/api/[...path]"],
    ["/api/students/day-log", "/api/[...path]"],
    ["/api/students/ogs-group-live", "/api/[...path]"],
    ["/api/students/1/documents", "/api/[...path]"],
    ["/api/staff/1", "/api/[...path]"],
    ["/api/staff/by-role", "/api/[...path]"],
    ["/api/staff/qualification-types", "/api/[...path]"],
    ["/api/rooms/1", "/api/[...path]"],
    ["/api/rooms/by-category", "/api/[...path]"],
    ["/api/activities/1", "/api/[...path]"],
    ["/api/activities/quick-create", "/api/[...path]"],
    ["/api/iot/device-slots", "/api/[...path]"],
    ["/api/search", "/api/[...path]"],
    // Images the browser may keep (#2352).
    ["/api/me/profile/avatar/a.png", "/api/[...path]"],
    ["/api/staff/1/avatar", "/api/[...path]"],
    ["/api/traeger/master-data/logo", "/api/traeger/[...path]"],
    // Documents and proofs of the contract (#2352), beside dynamic
    // neighbours that keep their route files.
    ["/api/enrollment/admin/requests/1/signature-proof", "/api/[...path]"],
    ["/api/parent-announcements/1/letters-pdf", "/api/[...path]"],
    ["/api/parent/me/documents/1/2/pdf", "/api/parent/[...path]"],
    ["/api/parent/me/news/1/declaration/proof/pdf", "/api/parent/[...path]"],
    [
      "/api/parent/me/children/1/pickup-requests/2/proof/pdf",
      "/api/parent/[...path]",
    ],
    [
      "/api/parent/parent-news-attachments/1/2/download",
      "/api/parent/[...path]",
    ],
    ["/api/school/class-day/absence-list/export", "/api/school/[...path]"],
    // Exports, templates and files of the contract (#2352), beside
    // dynamic neighbours that keep their route files.
    ["/api/staff/1/time-tracking/export", "/api/[...path]"],
    ["/api/holiday-weeks/1/participants/export", "/api/[...path]"],
    ["/api/calendar/appointments/1/ics", "/api/[...path]"],
    ["/api/week-protocols/1/pdf", "/api/[...path]"],
    ["/api/import/students/template", "/api/[...path]"],
    ["/api/caterer/orders/export", "/api/caterer/[...path]"],
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
    // Files and an upload of the contract (#2352).
    ["/api/students/day-log/export", "/api/[...path]"],
    ["/api/traeger/access-log/export", "/api/traeger/[...path]"],
    ["/api/traeger/documents/1/file", "/api/traeger/[...path]"],
    [
      "/api/traeger/holiday-periods/1/registrations/2/proofs",
      "/api/traeger/[...path]",
    ],
    // Uploads the backend checks like the frontend server did (#2352).
    ["/api/announcement-attachments/1", "/api/[...path]"],
    ["/api/enrollment/legal-documents", "/api/[...path]"],
    ["/api/files/folders/1/files", "/api/[...path]"],
    ["/api/me/profile/avatar", "/api/[...path]"],
    ["/api/settings/enrollment/legal-agb-document", "/api/[...path]"],
    ["/api/staff/1/documents", "/api/[...path]"],
    ["/api/students/1/accident-reports/2/paper-copy", "/api/[...path]"],
    ["/api/students/1/photo", "/api/[...path]"],
  ])("%s goes to %s", (sample, expected) => {
    expect(routeFiles.find(({ match }) => match(sample))?.route).toBe(expected);
  });
});
