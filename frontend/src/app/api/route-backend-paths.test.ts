import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  portalRoutes,
  routeFileRoutes,
} from "~/lib/contract/portals.generated";
import { PORTALS } from "~/server/auth/portals";
import { localSessionKeys } from "~/lib/session-bff";
import { sourceBindings } from "~/test/helpers/source-bindings";

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
    const pathname = value
      ?.replace(/^(?:GET|POST|PUT|PATCH|DELETE) /, "")
      .split(/[?#]/, 1)[0];
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
  .map((file) => {
    const source = readFileSync(path.join(apiDir, file), "utf8");
    return {
      file,
      source,
      route: path.dirname(file),
      ...classify(file, source),
    };
  })
  .sort((a, b) => a.route.localeCompare(b.route));

/** "METHOD /pattern" of every route a portal's own route file serves. */
const routeFileKeys = Object.values(routeFileRoutes).flatMap((routes) =>
  routes.map((route) => key(route.method, segmentsOf(route.pattern))),
);

/** The server modules beside the route files that call the backend. */
const serverAuthDir = path.resolve(apiDir, "../../server/auth");
const serverAuthSources = readdirSync(serverAuthDir, { encoding: "utf8" })
  .filter((file) => file.endsWith(".ts") && !file.includes(".test."))
  .map((file) => ({
    file,
    source: readFileSync(path.join(serverAuthDir, file), "utf8"),
  }));
/** Follow the exported handler's local references, not strings in its file. */
function handlerContracts(file: string, text: string, method: string) {
  const { source, binding, declaration } = sourceBindings(file, text);
  const seen = new Set<ts.Node>();
  const followed = new Set<ts.Node>();
  const keys = new Set<string>();
  const portalOwners = Object.entries(PORTALS).map(([name, { backend }]) => ({
    modulePath: name === "tenant" ? "~/server/auth" : `~/server/auth/${name}`,
    exportName: `${name}Portal`,
    backend,
  }));
  const portalOwner = (value: ts.Expression) => {
    const { from, names } = binding(value);
    return portalOwners.find(
      ({ modulePath, exportName }) =>
        from === modulePath && names[0] === exportName,
    );
  };
  const portalCallback = (callee: ts.Expression) => {
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const { expression: receiver, name } = callee;
    if (name.text === "withAuth") return Boolean(portalOwner(receiver));
    if (
      name.text !== "withSessionResponse" ||
      !ts.isElementAccessExpression(receiver) ||
      !ts.isIdentifier(receiver.expression)
    )
      return false;
    const table = declaration(receiver.expression);
    if (!table || !ts.isVariableDeclaration(table) || !table.initializer)
      return false;
    let initializer = table.initializer;
    while (
      ts.isParenthesizedExpression(initializer) ||
      ts.isAsExpression(initializer) ||
      ts.isSatisfiesExpression(initializer)
    )
      initializer = initializer.expression;
    return (
      ts.isObjectLiteralExpression(initializer) &&
      initializer.properties.length > 0 &&
      initializer.properties.every(
        (entry) =>
          ts.isPropertyAssignment(entry) &&
          Boolean(portalOwner(entry.initializer)),
      )
    );
  };
  const record = (operand: ts.Expression | undefined) => {
    if (!operand) return;
    const { from, names } = binding(operand);
    if (from?.startsWith("~/lib/contract/") && from.endsWith(".generated")) {
      const [table, route] = names;
      if (table === "routes" && route) keys.add(route);
    }
  };
  const follow = (node: ts.Node | undefined) => {
    if (!node || followed.has(node)) return;
    followed.add(node);
    if (ts.isIdentifier(node)) follow(declaration(node));
    else if (ts.isVariableDeclaration(node)) follow(node.initializer);
    else if (ts.isParenthesizedExpression(node)) follow(node.expression);
    else if (ts.isFunctionLike(node) && "body" in node && node.body)
      visit(node.body);
    else visit(node);
  };
  const visit = (node: ts.Node) => {
    if (seen.has(node) || ts.isFunctionLike(node)) return;
    seen.add(node);
    if (ts.isCallExpression(node)) {
      const factory = binding(node.expression);
      const [portal, step, explicitRoute] = node.arguments;
      const imported = factory.names[0] ?? "";
      follow(node.expression);
      if (
        (factory.from === "~/lib/private-no-store" &&
          imported === "withPrivateNoStore") ||
        (factory.from === "~/lib/route-wrapper.server" &&
          [
            "createGetHandler",
            "createPutHandler",
            "createDeleteHandler",
          ].includes(imported)) ||
        (factory.from === "~/lib/operator/route-wrapper.server" &&
          ["createOperatorPutHandler", "createOperatorDeleteHandler"].includes(
            imported,
          )) ||
        (factory.from === "~/lib/file-upload-wrapper.server" &&
          imported === "createFileUploadHandler") ||
        portalCallback(node.expression)
      )
        follow(portal);
      if (
        (factory.from === "~/lib/contract/client.server" &&
          (imported === "contractGet" || imported === "contractWrite")) ||
        (factory.from === "~/lib/auth-proxy.server" &&
          imported === "authStepProxy")
      )
        record(portal);
      if (
        factory.from === "~/lib/login-route.server" &&
        imported === "createPortalLoginRoute"
      )
        record(explicitRoute);
      if (
        factory.from?.startsWith(".") &&
        path.posix.join(path.posix.dirname(file), factory.from) ===
          "demo/access/forward" &&
        imported === "forwardDemoToken"
      )
        record(step);
      if (
        factory.from === "~/lib/factor-routes.server" &&
        imported === "createFactorConfirmRoute" &&
        portal &&
        ts.isObjectLiteralExpression(portal)
      ) {
        for (const property of portal.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText(source) === "route"
          )
            record(property.initializer);
        }
      }
      const login =
        factory.from === "~/lib/login-route.server" &&
        factory.names[0] === "createPortalLoginRoute" &&
        !explicitRoute &&
        step &&
        ts.isStringLiteral(step) &&
        step.text === "login";
      const logout =
        factory.from === "~/lib/logout-route.server" &&
        factory.names[0] === "createLogoutRoute";
      if (portal && (login || logout)) {
        const { backend } = portalOwner(portal) ?? {};
        if (backend) {
          const route = login ? backend.login : backend.logout.route;
          keys.add(`${route.method} ${route.pattern}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const node of source.statements) {
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const { name, propertyName } of node.exportClause.elements) {
        if (name.text === method && ts.isIdentifier(propertyName ?? name))
          follow(propertyName ?? name);
      }
    }
    if (
      !ts.canHaveModifiers(node) ||
      !ts
        .getModifiers(node)
        ?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    if (ts.isFunctionDeclaration(node) && node.name?.text === method)
      follow(node);
    if (ts.isVariableStatement(node)) {
      for (const entry of node.declarationList.declarations) {
        if (ts.isIdentifier(entry.name) && entry.name.text === method)
          follow(entry);
      }
    }
  }
  return keys;
}

const browserContractKeys = new Set<string>(
  Object.values(routeFileRoutes).flatMap((routes) =>
    routes.flatMap((route) =>
      "browserPath" in route ? [`${route.method} ${route.pattern}`] : [],
    ),
  ),
);

function browserHandlerContracts(file: string, text: string, method: string) {
  // Secondary server-only calls (e.g. resolving the school to purge its
  // cache) do not define the browser-facing dispatch of the handler.
  return [...handlerContracts(file, text, method)].filter((key) =>
    browserContractKeys.has(key),
  );
}

describe("route served by a portal's own route file", () => {
  it("binds each method to its own Go route, through aliases but not sibling handlers", () => {
    const text = `
      import { routes as table } from "~/lib/contract/operator-auth.generated";
      import { contractWrite as send } from "~/lib/contract/client.server";
      import { withPrivateNoStore as wrap } from "~/lib/private-no-store";
      const accept = table["POST /operator/auth/invitations/accept"];
      function validate() {
        void accept;
        return send(table["POST /operator/auth/invitations/validate"]);
      }
      export const POST = wrap(validate);
      export function PUT() { return send(accept); }
      export function PATCH() {
        void validate;
        return new Response(null, { status: 204 });
      }
      export function DELETE() {
        if (condition) return validate();
        return send(accept);
      }
    `;
    expect(handlerContracts("probe.ts", text, "POST")).toEqual(
      new Set(["POST /operator/auth/invitations/validate"]),
    );
    expect(handlerContracts("probe.ts", text, "PUT")).toEqual(
      new Set(["POST /operator/auth/invitations/accept"]),
    );
    expect(handlerContracts("probe.ts", text, "PATCH")).toEqual(new Set());
    expect(browserHandlerContracts("probe.ts", text, "DELETE")).not.toEqual([
      "POST /operator/auth/invitations/validate",
    ]);
  });

  for (const [portal, routes] of Object.entries(routeFileRoutes)) {
    for (const route of routes) {
      if (!("browserPath" in route)) continue;
      const address = route.browserPath;
      const method =
        "browserMethod" in route ? route.browserMethod : route.method;
      it(`${portal} ${route.method} ${route.pattern} serves ${method} ${address}`, () => {
        const folder = address
          .slice("/api/".length)
          .replace(/\{([^}]+)\}/g, "[$1]");
        const row = routeFiles.find(({ route }) => route === folder);
        if (!row) throw new Error(`missing route file at ${address}`);
        expect(
          browserHandlerContracts(row.file, row.source, method),
          "the exported method must dispatch only to its registered browser-facing Go route",
        ).toEqual([`${route.method} ${route.pattern}`]);
      });
    }
  }
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
      import { apiGet } from "~/lib/retired-transport.server";
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

// Named JSON routes and the Auth.js session modules must use the generated
// entry, not make a second raw call to the same Go path (#7942).
const namedKeys = new Set(routeFileKeys);
const knownContractCall = new Set([
  "contractGet",
  "contractWrite",
  "createPortalLoginRoute",
  "authStepProxy",
]);
const rawCalls =
  /^(?:fetch|sendBackend|readBackendJson|backendFetch|api(?:Get|Post|Put|Patch|Delete)|postForm|api)$/;

function handlerCalls(file: string, text: string) {
  const { source, binding } = sourceBindings(file, text);
  const methods = new Set<string>();
  for (const statement of source.statements) {
    if (
      ts.canHaveModifiers(statement) &&
      ts
        .getModifiers(statement)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (ts.isFunctionDeclaration(statement) && statement.name)
        methods.add(statement.name.text);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name))
            methods.add(declaration.name.text);
        }
      }
    }
  }
  const callee = ({ expression }: ts.CallExpression) =>
    binding(expression).names.at(-1) ?? "";
  const isDecoderCall = ({ expression }: ts.CallExpression) => {
    const { from, names } = binding(expression);
    return (
      from !== undefined &&
      from.endsWith("contract/client.server") &&
      (names[0] === "contractGet" || names[0] === "contractWrite")
    );
  };

  // backendFetch can supply the transport, but does not return the raw
  // response to the route. Only the contract helper gets it.
  function isContractTransport(node: ts.CallExpression): boolean {
    const arrow = node.parent;
    if (!ts.isArrowFunction(arrow)) return false;
    const property = arrow.parent;
    if (
      !ts.isPropertyAssignment(property) ||
      !(
        (ts.isIdentifier(property.name) ||
          ts.isStringLiteralLike(property.name)) &&
        property.name.text === "send"
      )
    )
      return false;
    let argument: ts.Node = property.parent;
    if (ts.isArrayLiteralExpression(argument.parent))
      argument = argument.parent;
    while (
      ts.isParenthesizedExpression(argument.parent) ||
      ts.isAsExpression(argument.parent)
    ) {
      argument = argument.parent;
    }
    if (ts.isSpreadElement(argument.parent)) argument = argument.parent;
    const call = argument.parent;
    return ts.isCallExpression(call) && isDecoderCall(call);
  }

  const entries = new Set<string>();
  const calls = new Set<string>();
  const bypasses = new Set<string>();
  let callsDecoder = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = callee(node);
      calls.add(name);
      if (isDecoderCall(node)) {
        callsDecoder = true;
      }
      if (rawCalls.test(name) && !isContractTransport(node)) bypasses.add(name);
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      const { from, names } = binding(node.expression);
      const owner = node.parent;
      if (
        from?.endsWith(".generated") &&
        names[0] === "routes" &&
        ((ts.isCallExpression(owner) && knownContractCall.has(callee(owner))) ||
          (ts.isPropertyAssignment(owner) &&
            (file === "portals.ts" ||
              (owner.name.getText(source) === "route" &&
                ts.isCallExpression(owner.parent.parent) &&
                callee(owner.parent.parent) === "createFactorConfirmRoute"))) ||
          (file === "portals.ts" && ts.isVariableDeclaration(owner)))
      ) {
        const [method, pattern] = node.argumentExpression.text.split(" ");
        if (method && pattern) entries.add(key(method, segmentsOf(pattern)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { entries, calls, bypasses, methods, callsDecoder };
}

const portalFactories = new Map<string, string>(
  Object.values(PORTALS).flatMap(
    (portal) =>
      [
        [`${portal.basePath.slice(5)}/login`, "createPortalLoginRoute"],
        [`${portal.basePath.slice(5)}/logout`, "createLogoutRoute"],
      ] as const,
  ),
);

function missingDecoders(file: string, source: string): string[] {
  const { entries, calls, methods } = handlerCalls(file, source);
  const factory = portalFactories.get(path.dirname(file));
  if (factory) return calls.has(factory) ? [] : [factory];
  return [
    ...new Set(
      placeOf(file).flatMap((name) =>
        reached(name).map(({ method, pattern }) =>
          methods.has(method) ? key(method, pattern) : "",
        ),
      ),
    ),
  ].filter((entry) => namedKeys.has(entry) && !entries.has(entry));
}

describe("RouteFile response decoding", () => {
  it("serves each BFF-only session key from its named route file", () => {
    for (const key of Object.values(localSessionKeys)) {
      const [method, pathname] = key.split(" ");
      const file = `${pathname?.slice("/api/".length)}/route.ts`;
      const route = routeFiles.find((item) => item.file === file);
      expect(route, key).toBeDefined();
      if (route)
        expect(handlerCalls(file, route.source).methods.has(method ?? "")).toBe(
          true,
        );
    }
  });

  it("uses every generated entry in a named handler or its portal's session table", () => {
    const missing = routeFiles.flatMap(({ file, source }) =>
      missingDecoders(file, source).map((entry) => `${file}: ${entry}`),
    );
    const entries = new Set(
      [...routeFiles, ...serverAuthSources].flatMap(({ file, source }) => [
        ...handlerCalls(file, source).entries,
      ]),
    );
    expect([
      ...missing,
      ...[...namedKeys].filter((entry) => !entries.has(entry)),
    ]).toEqual([]);
  });

  it("keeps shared handlers on the generated decoder and rejects raw transport calls", () => {
    const authHelpers = [
      "auth-proxy.server.ts",
      "factor-routes.server.ts",
      "login-route.server.ts",
      "logout-route.server.ts",
      "session-transition.server.ts",
    ].map((file) => ({
      file,
      source: readFileSync(path.resolve(apiDir, "../../lib", file), "utf8"),
    }));
    expect(
      authHelpers
        .filter(({ file, source }) => !handlerCalls(file, source).callsDecoder)
        .map(({ file }) => file),
    ).toEqual([]);

    const namedPaths = new Set(
      [...namedKeys].map((entry) => entry.split(" ")[1]),
    );
    const owners = routeFiles.filter(
      ({ file, source }) =>
        portalFactories.has(path.dirname(file)) ||
        [...placeOf(file), ...pathsIn(file, source)].some((name) =>
          reached(name).some(({ pattern }) =>
            namedPaths.has(`/${pattern.join("/")}`),
          ),
        ),
    );
    const bypasses = [...owners, ...serverAuthSources, ...authHelpers].flatMap(
      ({ file, source }) =>
        [...handlerCalls(file, source).bypasses].map(
          (call) => `${file}: ${call}`,
        ),
    );
    expect(bypasses).toEqual([]);
  });

  it("rejects an aliased raw call even when another handler uses that entry", () => {
    const file = "auth/staff-preview/end/route.ts";
    const previous = `
      import { sendBackend as send } from "~/lib/backend-client.server";
      export async function POST() {
        const response = await send("/auth/staff-preview/end", null, { method: "POST" });
        return Response.json(await response.json());
      }
    `;
    expect(missingDecoders(file, previous)).toEqual([
      "POST /auth/staff-preview/end",
    ]);
    expect([...handlerCalls(file, previous).bypasses]).toEqual(["sendBackend"]);
  });
});

// The transports and the unregistered stream may call the backend directly.
// Each exception must still name a call in its file.
const serverTransportExceptions: Record<string, readonly string[]> = {
  "lib/backend-client.server.ts": ["fetch"],
  "lib/contract/catalog-proxy.server.ts": ["sendBackend", "backendFetch"],
  "lib/contract/client.server.ts": ["sendBackend", "readBackendJson"],
  "lib/sse-proxy.server.ts": ["sendBackend"],
};

function serverTransportBypasses(file: string, source: string): string[] {
  return [...handlerCalls(file, source).bypasses].filter(
    (name) =>
      (name !== "fetch" || /getServerApiUrl|\bAPI_URL\b/.test(source)) &&
      !serverTransportExceptions[file]?.includes(name),
  );
}

describe("Server response decoding", () => {
  it("removes exceptions once their transport call is gone", () => {
    const src = path.resolve(apiDir, "../..");
    const stale = Object.entries(serverTransportExceptions).flatMap(
      ([file, calls]) => {
        const source = readFileSync(path.join(src, file), "utf8");
        const present = handlerCalls(file, source).bypasses;
        return calls
          .filter((name) => !present.has(name))
          .map((name) => `${file}: ${name}`);
      },
    );
    expect(stale).toEqual([]);
  });

  it("does not call the backend outside the contract and transport boundaries", () => {
    const src = path.resolve(apiDir, "../..");
    const violations = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter(
        (file) =>
          /\.tsx?$/.test(file) &&
          !/\.(test|spec|stories|generated|d)\./.test(file),
      )
      .flatMap((file) => {
        const source = readFileSync(path.join(src, file), "utf8");
        if (
          !file.endsWith(".server.ts") &&
          !file.startsWith("server/") &&
          !file.startsWith("app/api/") &&
          !/backend-client\.server|\bAPI_URL\b/.test(source)
        )
          return [];
        return serverTransportBypasses(file, source).map(
          (name) => `${file}: ${name}`,
        );
      });
    expect(violations).toEqual([]);
  });

  it("catches a typed unchecked read in a shell helper even under an alias", () => {
    const source = `
      import * as backend from "~/lib/backend-client.server";
      const read = backend["sendBackend"];
      const endpoint = "/api/me/groups/supervised";
      export const load = (token: string) =>
        read(endpoint, token, { method: "GET" });
    `;
    expect(
      serverTransportBypasses("lib/shell-bootstrap.server.ts", source),
    ).toEqual(["sendBackend"]);
  });
});
