import { describe, expect, it } from "vitest";
import {
  CATALOG_OUTSIDE_MOUNTS,
  CATALOG_PUBLIC_OUTSIDE_MOUNTS,
  underOutsideHead,
} from "./catalog-outside-mounts";
import { portalRoutes } from "./portals.generated";

/**
 * The staff portal's account routes live below `/auth`, beside Auth.js and
 * the sign-in routes (#2352). A portal's catalog proxy may serve the
 * account's own and the administration routes there, never a step that
 * signs in or mints a session: those keep their route files, which install
 * the session in the portal's cookies.
 */

const lists = [
  ...Object.entries(CATALOG_OUTSIDE_MOUNTS),
  ...Object.entries(CATALOG_PUBLIC_OUTSIDE_MOUNTS).map(
    ([portal, heads]) => [`public ${portal}`, heads] as const,
  ),
].flatMap(([portal, heads]) =>
  (heads as readonly string[]).map((head) => ({ portal, head })),
);

/** Whole areas of sign-in steps; only paths below them may be named. */
const WHOLE_AREAS = ["/auth", "/auth/mfa", "/auth/passkeys"];

/** Sign-in steps, as paths and as the tail of a registered pattern. */
const SIGN_IN_PATHS = [
  "/auth/login",
  "/auth/token",
  "/auth/refresh",
  "/auth/logout",
  "/auth/mfa/verify",
  "/auth/mfa/resend",
  "/auth/mfa/enroll/start",
  "/auth/mfa/enroll/confirm",
  "/auth/passkeys/login/options",
  "/auth/passkeys/login/verify",
  "/auth/password-reset",
  "/auth/password-reset/confirm",
  "/auth/switch-tenant",
];

const SIGN_IN_PATTERN =
  /(?:^|\/)(?:login|token)(?:\/|$)|\/mfa\/verify(?:\/|$)|\/passkeys\/login(?:\/|$)|\/password-reset(?:\/|$)/;

const segmentsOf = (path: string) => path.split("/").filter(Boolean);

describe("catalog proxy beside a portal's mount", () => {
  it.each(lists)("$portal $head names no whole sign-in area", ({ head }) => {
    // A head with a trailing slash names only that path itself.
    expect(WHOLE_AREAS).not.toContain(head);
  });

  it.each(lists)("$portal $head admits no sign-in step", ({ head }) => {
    for (const path of SIGN_IN_PATHS) {
      expect(underOutsideHead(segmentsOf(path), head), path).toBe(false);
    }
  });

  it("refuses a whole area also when it is spelled as a head", () => {
    for (const area of WHOLE_AREAS) {
      expect(
        SIGN_IN_PATHS.some((path) => underOutsideHead(segmentsOf(path), area)),
        area,
      ).toBe(true);
    }
  });
});

describe("portal catalogs", () => {
  const routes = Object.entries(portalRoutes).flatMap(([portal, list]) =>
    list.map((route) => ({
      portal,
      route: `${route.method} ${route.pattern}`,
      pattern: route.pattern,
    })),
  );

  it("cover the routes this guard reads", () => {
    expect(routes.map((entry) => entry.route)).toContain("GET /auth/passkeys/");
  });

  it.each(routes)("$portal $route is no sign-in step", ({ pattern }) => {
    expect(pattern).not.toMatch(SIGN_IN_PATTERN);
  });
});
