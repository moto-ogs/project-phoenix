import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  portalRoutes,
  routeFileRoutes,
} from "~/lib/contract/portals.generated";
import { PORTALS } from "~/server/auth/portals";

vi.mock("~/env", () => ({ env: { TENANT_DOMAIN: "localhost" } }));

/**
 * A route file of its own calls the backend for a reason the catalog proxy
 * cannot serve (#2353, #7808): a sign-in step that installs the session, a
 * write that purges a cache, a device header. The backend marks each such
 * route on its contract, as `RouteFile` (typed, listed in `routeFileRoutes`)
 * or `Outside` (no contract: a stream, a device). A route file whose backend
 * paths are all in a portal's proxy allowlist (`portalRoutes`) repeats what
 * the portal's catalog proxy already serves and fails here. Its backend path
 * is registered; the page calls the BFF path and `app/api/<portal>/[...path]`
 * answers it. Every `RouteFile` route needs the route file that serves it.
 *
 * "Backend path" is every string or template in the file that names a route
 * of the backend's route catalog (`backend/api/testdata/routes`), and the
 * file's own place below `app/api` (`auth/mfa/verify/route.ts` serves
 * `/auth/mfa/verify`). New `Outside` lines need an ADR
 * (`scripts/check-contract-shrink.mjs`), so a new route file cannot reach a
 * new route without types either. Not seen here: a path a route file reaches
 * through a helper or a constant of another module, and a template that
 * starts with an expression (`${prefix}/groups`). One path outside the
 * allowlists is enough for the whole file, the HTTP method is not compared.
 */

const apiDir = path.dirname(new URL(import.meta.url).pathname);
const catalogDir = path.resolve(
  apiDir,
  "../../../../backend/api/testdata/routes",
);

/** Segments of a pattern or a path: `{}` for a parameter, `*` for the rest. */
function segmentsOf(pattern: string): string[] {
  return pattern
    .replaceAll("/*/", "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment.includes("{") ? "{}" : segment));
}

/** Whether a path names a route of the pattern; a `{}` of the path is a value. */
function names(pathSegments: string[], pattern: string[]): boolean {
  for (const [index, segment] of pattern.entries()) {
    if (segment === "*") return true;
    const part = pathSegments[index];
    if (part === undefined) return false;
    if (segment === "{}") continue;
    if (part !== segment) return false;
  }
  return pathSegments.length === pattern.length;
}

/** The paths a source names: strings and templates that start with `/`. */
function pathsIn(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    let value: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      value = node.text;
    } else if (ts.isTemplateExpression(node)) {
      value =
        node.head.text +
        node.templateSpans.map((span) => `{}${span.literal.text}`).join("");
    }
    const pathname = value?.split(/[?#]/, 1)[0];
    if (pathname?.startsWith("/")) found.push(pathname);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const catalog = readdirSync(catalogDir, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".golden"))
  .flatMap((file) =>
    readFileSync(path.join(catalogDir, file), "utf8").split("\n"),
  )
  .filter(Boolean)
  .map((line) => {
    const [method, pattern] = line.split(" ") as [string, string];
    return { method, pattern: segmentsOf(pattern) };
  });

const key = (method: string, pattern: string[]) =>
  `${method} /${pattern.join("/")}`;
const registered = new Set(
  Object.values(portalRoutes).flatMap((routes) =>
    routes.map((route) => key(route.method, segmentsOf(route.pattern))),
  ),
);

/**
 * The catalog rows a path reaches. Like chi, a static segment wins over a
 * parameter and a parameter over the rest: `/api/display/dashboard` is that
 * route, not `/api/display/{id}`.
 */
function reached(name: string) {
  const parts = segmentsOf(name);
  const rank = (pattern: string[]) =>
    pattern
      .map((segment) => (segment === "*" ? "0" : segment === "{}" ? "1" : "2"))
      .join("");
  const matches = catalog.filter((route) => names(parts, route.pattern));
  const best = matches
    .map((route) => rank(route.pattern))
    .sort()
    .at(-1);
  return matches.filter((route) => rank(route.pattern) === best);
}

/**
 * The backend paths a route file's place below `app/api` stands for: the
 * BFF path itself and, for a portal's own auth steps, the path without
 * `/api` (`api/operator/auth/mfa/verify` → `/operator/auth/mfa/verify`).
 */
function placeOf(file: string): string[] {
  const parts = path.dirname(file).split(path.sep);
  if (parts.some((part) => part.startsWith("[..."))) return [];
  const bff = parts.map((part) =>
    part.startsWith("[") ? `{${part.slice(1, -1)}}` : part,
  );
  return [`/api/${bff.join("/")}`, `/${bff.join("/")}`];
}

/** The backend paths a route file names, by whether the contract registers them. */
function classify(file: string, text: string) {
  // "/" alone is a frontend redirect, never the backend's index.
  const paths = [...new Set(pathsIn(file, text))].filter(
    (name) => segmentsOf(name).length > 0,
  );
  const rows = paths.map((name) => ({ name, rows: reached(name) }));
  const where = (wanted: boolean) =>
    rows
      .filter(({ rows: hits }) =>
        hits.some(
          (route) =>
            registered.has(key(route.method, route.pattern)) === wanted,
        ),
      )
      .map(({ name }) => name);
  return { registered: where(true), unregistered: where(false) };
}

const routeFiles = readdirSync(apiDir, { recursive: true, encoding: "utf8" })
  .filter((file) => path.basename(file) === "route.ts")
  .map((file) => ({
    route: path.dirname(file),
    ...classify(file, readFileSync(path.join(apiDir, file), "utf8")),
  }))
  .sort((a, b) => a.route.localeCompare(b.route));

/** "METHOD /pattern" of every route a portal's own route file serves. */
const routeFileKeys = Object.values(routeFileRoutes).flatMap((routes) =>
  routes.map((route) => key(route.method, segmentsOf(route.pattern))),
);

/**
 * The paths the Auth.js handlers of every portal call through the portal
 * table: the password sign-in, the renewal and the sign-out. Auth.js'
 * catch-all route file serves them.
 */
const authJsPaths = Object.values(PORTALS).flatMap((portal) => [
  `${portal.backend.authPrefix}/login`,
  portal.backend.refresh.path,
  portal.backend.logout.path,
]);

/** The server modules beside the route files that call the backend. */
const serverAuthDir = path.resolve(apiDir, "../../server/auth");
const serverAuthPaths = readdirSync(serverAuthDir, { encoding: "utf8" })
  .filter((file) => file.endsWith(".ts") && !file.includes(".test."))
  .flatMap((file) =>
    pathsIn(file, readFileSync(path.join(serverAuthDir, file), "utf8")),
  );

/** Catalog rows some route file, or Auth.js through the portal table, names. */
const named = new Set(
  [
    ...routeFiles.flatMap((file) => [...file.registered, ...file.unregistered]),
    ...readdirSync(apiDir, { recursive: true, encoding: "utf8" })
      .filter((file) => path.basename(file) === "route.ts")
      .flatMap(placeOf),
    ...authJsPaths,
    ...serverAuthPaths,
  ].flatMap((name) =>
    reached(name).map((route) => `/${route.pattern.join("/")}`),
  ),
);

describe("route served by a portal's own route file", () => {
  it.each(routeFileKeys)("%s has its route file", (routeKey) => {
    const pattern = routeKey.slice(routeKey.indexOf(" ") + 1);
    expect(
      named.has(pattern),
      "the contract names RouteFile, but no route file serves the route: add it, or drop RouteFile so the catalog proxy serves it",
    ).toBe(true);
  });
});

describe("route file with backend calls of its own", () => {
  it("reads the route catalog and the contract", () => {
    const known = catalog.filter((route) =>
      registered.has(key(route.method, route.pattern)),
    );
    expect(known.length).toBeGreaterThan(1000);
    expect(catalog.length).toBeGreaterThan(known.length);
    // The sign-in steps, streams and bundles name their backend paths.
    expect(
      routeFiles.filter((file) => file.unregistered.length > 0).length,
    ).toBeGreaterThan(20);
  });

  it.each(routeFiles)(
    "api/$route names a backend route the contract does not register, or none",
    ({ registered, unregistered }) => {
      if (registered.length === 0) return;
      expect(
        unregistered,
        `only registered backend paths (${registered.join(", ")}): the catalog proxy serves them; delete the route file`,
      ).not.toEqual([]);
    },
  );

  it("refuses a file whose backend paths the contract registers", () => {
    const text = `
      import { apiGet } from "~/lib/api-helpers.server";
      import { createGetHandler } from "~/lib/route-wrapper.server";
      export const GET = createGetHandler((_request, token, params) =>
        apiGet(\`/api/groups/\${String(params.id)}?details=1\`, token));
    `;
    expect(classify("route.ts", text)).toEqual({
      registered: ["/api/groups/{}"],
      unregistered: [],
    });
  });

  it("keeps a bundle that also calls a route without a contract", () => {
    const text = `
      apiGet(\`/api/students?\${params}\`, token);
      apiGet(\`/api/display/dashboard\`, token);
    `;
    expect(classify("route.ts", text).unregistered).toEqual([
      "/api/display/dashboard",
    ]);
  });
});
