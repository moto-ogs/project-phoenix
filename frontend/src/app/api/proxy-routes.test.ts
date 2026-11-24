import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import typescript from "typescript";
import { describe, expect, it } from "vitest";
import { bffPath, type Portal } from "~/lib/bff-fetch";
import {
  portalRoutes,
  routeFileRoutes,
} from "~/lib/contract/portals.generated";

// Copy the namespace once: property lookups on the module object dominate a
// walk over every node of the production source.
const ts = { ...typescript };

const src = path.resolve(__dirname, "../..");

// These names must not come back as imports, declarations or property calls,
// even in a route that does more than forwarding or builds its path elsewhere.
const retired = new Set([
  ...["Get", "Post", "Put", "Patch", "Delete", "File", "Upload"].map(
    (suffix) => "proxy" + suffix,
  ),
  ["json", "Proxy"].join(""),
  ["forwardTo", "Backend"].join(""),
  ...["Get", "Post", "Delete"].map((suffix) => "operatorApi" + suffix),
]);

const unknownSegment = "__route_parameter__";

// Iterate heterogeneous entries without instantiating every combination of
// portal, route key and params.
const address = bffPath as unknown as (
  portal: Portal,
  key: string,
  options: { params: Record<string, string> },
) => string;
const routePatterns = new Set<string>();
for (const table of [portalRoutes, routeFileRoutes]) {
  for (const [portal, routes] of Object.entries(table)) {
    for (const route of routes) {
      // Mark parameters before building the proxy URL without a real ID.
      const params = Object.fromEntries(
        [...route.pattern.matchAll(/\{([^}]+)\}/g)].map((match) => [
          match[1],
          unknownSegment,
        ]),
      );
      const url = address(
        portal as Portal,
        `${route.method} ${route.pattern}`,
        { params },
      );
      routePatterns.add(url);
    }
  }
}
const routesByResource = new Map<string, RegExp[]>();
function resource(pathname: string): string {
  return pathname.split("/")[2] ?? "";
}
for (const pattern of routePatterns) {
  const key = resource(pattern);
  const routes = routesByResource.get(key) ?? [];
  routes.push(
    new RegExp(
      "^" +
        pattern
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replaceAll(unknownSegment, "[^/]+") +
        "/?$",
    ),
  );
  routesByResource.set(key, routes);
}

// The host router compares these incoming paths; it does not build addresses.
const hostAllowlist = new Set([
  "/api/auth/tenant/resolve",
  "/api/auth/tenants",
]);

/** Follow values, not identifier names: constants, aliases and local helpers. */
function urlShapes(
  node: typescript.Node,
  checker: typescript.TypeChecker,
  active = new Set<typescript.Node>(),
  bindings: ReadonlyMap<typescript.ParameterDeclaration, string[]> = new Map(),
): string[] {
  if (active.has(node) || active.size >= 32) return [unknownSegment];
  active.add(node);
  function declarationOf(expression: typescript.Node) {
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration;
  }
  const visit = (part: typescript.Node) =>
    urlShapes(part, checker, active, bindings);
  const join = (left: string[], right: string[]) =>
    left
      .flatMap((prefix) => right.map((suffix) => prefix + suffix))
      .slice(0, 32);
  try {
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    )
      return visit(node.expression);
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.reduce(
        (prefix, { expression, literal }) =>
          join(join(prefix, visit(expression)), [literal.text]),
        [node.head.text],
      );
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    )
      return join(visit(node.left), visit(node.right));
    if (ts.isConditionalExpression(node)) {
      return [...visit(node.whenTrue), ...visit(node.whenFalse)].slice(0, 32);
    }
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const declaration = declarationOf(node);
      if (declaration && ts.isParameter(declaration)) {
        return bindings.get(declaration) ?? [unknownSegment];
      }
      if (
        declaration &&
        (ts.isVariableDeclaration(declaration) ||
          ts.isPropertyAssignment(declaration) ||
          ts.isBindingElement(declaration)) &&
        declaration.initializer
      )
        return visit(declaration.initializer);
    }
    if (isArrayJoin(node)) {
      const separator = node.arguments[0];
      if (separator && !ts.isStringLiteralLike(separator))
        return [unknownSegment];
      return node.expression.expression.elements.reduce<string[]>(
        (parts, item, index) =>
          join(
            index === 0 ? parts : join(parts, [separator?.text ?? ","]),
            visit(item),
          ),
        [""],
      );
    }
    if (ts.isCallExpression(node)) {
      const target = declarationOf(node.expression);
      const declaration =
        target && ts.isVariableDeclaration(target)
          ? target.initializer
          : target;
      if (
        declaration &&
        (ts.isFunctionDeclaration(declaration) ||
          ts.isArrowFunction(declaration) ||
          ts.isFunctionExpression(declaration) ||
          ts.isMethodDeclaration(declaration)) &&
        declaration.body
      ) {
        const callBindings = new Map(bindings);
        declaration.parameters.forEach((parameter, index) => {
          const argument = node.arguments[index] ?? parameter.initializer;
          if (argument) callBindings.set(parameter, visit(argument));
        });
        const result = (expression: typescript.Expression) =>
          urlShapes(expression, checker, active, callBindings);
        if (!ts.isBlock(declaration.body)) return result(declaration.body);
        const returns: string[] = [];
        function collect(part: typescript.Node) {
          if (ts.isReturnStatement(part) && part.expression)
            returns.push(...result(part.expression));
          else if (!ts.isFunctionLike(part)) ts.forEachChild(part, collect);
        }
        collect(declaration.body);
        if (returns.length) return returns;
      }
    }
    return [unknownSegment];
  } finally {
    active.delete(node);
  }
}

function isArrayJoin(
  node: typescript.Node,
): node is typescript.CallExpression & {
  expression: typescript.PropertyAccessExpression & {
    expression: typescript.ArrayLiteralExpression;
  };
} {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join" &&
    ts.isArrayLiteralExpression(node.expression.expression)
  );
}

function violations(
  source: typescript.SourceFile,
  checker: typescript.TypeChecker,
): string[] {
  const findings: string[] = [];
  const report = (node: typescript.Node, message: string) => {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    findings.push(`${line + 1}: ${message}`);
  };
  function isRegistered(value: string) {
    if (!value.includes("/api/")) return false;
    const relative = value.replace(
      /^(?:https?:\/\/[^/]+|__route_parameter__)(?=\/api\/)/,
      "",
    );
    if (!relative.startsWith("/api/")) return false;
    const pathname = relative.split(/[?#]/, 1)[0]!.replace(/\/$/, "");
    if (
      path.relative(src, source.fileName) === "proxy.ts" &&
      hostAllowlist.has(pathname)
    )
      return false;
    return (
      routesByResource
        .get(resource(pathname))
        ?.some((match) => match.test(pathname)) ?? false
    );
  }
  const visit = (node: typescript.Node) => {
    if (ts.isIdentifier(node) && retired.has(node.text)) {
      report(node, `retired route helper: ${node.text}`);
    }
    const isAssembled =
      ts.isTemplateExpression(node) ||
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
      isArrayJoin(node) ||
      (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.arguments.some(
          (argument) =>
            (ts.isIdentifier(argument) ||
              ts.isStringLiteralLike(argument) ||
              (ts.isCallExpression(argument) &&
                ts.isIdentifier(argument.expression))) &&
            urlShapes(argument, checker).some((value) =>
              value.includes("/api"),
            ),
        ));
    if (
      ts.isStringLiteralLike(node)
        ? isRegistered(node.text)
        : isAssembled && urlShapes(node, checker).some(isRegistered)
    ) {
      report(
        node,
        "use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
      );
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function probe(text: string): string[] {
  const file = path.join(src, "probe.ts");
  const options = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options, true);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  host.getSourceFile = (name) => (name === file ? source : undefined);
  return violations(
    source,
    ts.createProgram([file], options, host).getTypeChecker(),
  );
}

function scanProject(sources: ReadonlyMap<string, string>): string[] {
  const options = {
    noLib: true,
    noResolve: true,
    types: [],
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { "~/*": [`${src}/*`], "@/*": [`${src}/*`] },
  };
  const host = ts.createCompilerHost(options, true);
  host.fileExists = (file) => sources.has(file);
  host.getSourceFile = (file) => {
    const source = sources.get(file);
    return source === undefined
      ? undefined
      : ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  };
  // Keep the compiler program within the worker heap. Start with possible
  // path pieces and add call-only files referring to a possible API prefix.
  // Include barrels so the checker can resolve their aliased declarations.
  const pathPieces = /["'`]\/[^/\s]|\}\/|\.join\s*\(|\\[xu]/;
  const barrel = /\bexport\s+(?:\*|\{)/;
  const cache = ts.createModuleResolutionCache(src, (file) => file, options);
  const resolved = new Map<string, string[]>();
  const imports = (file: string, source: string) => {
    let targets = resolved.get(file);
    if (!targets) {
      targets = ts
        .preProcessFile(source)
        .importedFiles.flatMap(({ fileName }) => {
          const target = ts.resolveModuleName(
            fileName,
            file,
            options,
            host,
            cache,
          ).resolvedModule?.resolvedFileName;
          return target ? [target] : [];
        });
      resolved.set(file, targets);
    }
    return targets;
  };
  const carriesPrefix = (file: string, seen: Set<string>): boolean => {
    if (seen.has(file)) return false;
    seen.add(file);
    const source = sources.get(file);
    return (
      source !== undefined &&
      (/["'`]\/api\b|["'`]\/["'`]|\\[xu]/.test(source) ||
        (barrel.test(source) &&
          imports(file, source).some((item) => carriesPrefix(item, seen))))
    );
  };
  const roots = [...sources]
    .filter(
      ([file, source]) =>
        pathPieces.test(source) ||
        barrel.test(source) ||
        [...retired].some((name) => source.includes(name)) ||
        (/\+|\b[\w$]+\s*(?:\?\.)?\(\s*[\w$]+/.test(source) &&
          imports(file, source).some((item) => carriesPrefix(item, new Set()))),
    )
    .map(([file]) => file);
  const program = ts.createProgram(roots, options, host);
  const checker = program.getTypeChecker();
  return roots.flatMap((file) =>
    violations(program.getSourceFile(file)!, checker).map(
      (finding) => `${path.relative(src, file)}:${finding}`,
    ),
  );
}

describe("BFF routes use the generated contract", () => {
  it("rejects a retired helper even with custom code and a computed endpoint", () => {
    const helper = ["proxy", "Get"].join("");
    const source = `
      import { ${helper} as forward } from "~/lib/route-wrapper.server";
      const endpoint = buildPath();
      export const GET = forward(endpoint);
    `;
    expect(probe(source)).toEqual([`2: retired route helper: ${helper}`]);
  });

  it("rejects literal and assembled addresses, including constants and helpers", () => {
    const source = [
      "const link = `/api/staff/${staffId}/documents/${docId}/download`;",
      'const logo = "/api/traeger/master-data/logo";',
      'const pdf = "/api/week-protocols/" + id + "/pdf";',
      'const base = "/api/traeger/master-data";',
      "const cached = `${base}/logo?v=1`;",
      "const documents = (id: string) => `/api/students/${id}/documents`;",
      "const download = `${documents(studentId)}/${docId}/download`;",
      'const joined = ["", "api", "traeger", "master-data", "logo"].join("/");',
      'const withLogo = (prefix: string) => prefix + "/logo";',
      "const passedPrefix = withLogo(base);",
      'const typed = bffFileHref("platform", "GET /operator/unrelated");',
    ].join("\n");
    expect(probe(source)).toEqual([
      "1: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
      "2: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
      "3: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
      "4: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
      "5: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
      "6: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
      "7: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
      "8: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
      "10: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
    ]);
  });

  it("checks a caller that only combines imported values", () => {
    const findings = scanProject(
      new Map([
        [
          path.join(src, "prefix.ts"),
          'export const base = "/api/traeger/master-data"; export const getBase = () => base;',
        ],
        [
          path.join(src, "helper.ts"),
          'export const withLogo = (prefix: string) => prefix + "/logo";',
        ],
        [
          path.join(src, "consumer.ts"),
          'import { base, getBase } from "./prefix";\nimport { withLogo } from "./helper";\nconst href = withLogo(base);\nconst nested = withLogo(getBase());',
        ],
      ]),
    );
    expect(findings).toContain(
      "consumer.ts:3: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
    );
    expect(findings).toContain(
      "consumer.ts:4: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
    );
  });

  it(
    "finds no retired route helpers or handwritten registered BFF addresses in production source",
    { timeout: 15_000 },
    () => {
      const sources = readdirSync(src, { recursive: true, encoding: "utf8" })
        .filter(
          (name) =>
            /\.tsx?$/.test(name) &&
            !/\.(?:generated|test|spec|stories|d)\.tsx?$/.test(name) &&
            !name.startsWith("test/"),
        )
        .map((file) => path.join(src, file));
      const findings = scanProject(
        new Map(sources.map((file) => [file, readFileSync(file, "utf8")])),
      );
      expect(findings).toEqual([]);
    },
  );
});
