import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { bffPath, type Portal } from "~/lib/bff-fetch";
import {
  portalRoutes,
  routeFileRoutes,
} from "~/lib/contract/portals.generated";

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
  node: ts.Node,
  checker: ts.TypeChecker,
  active = new Set<ts.Node>(),
  bindings: ReadonlyMap<ts.ParameterDeclaration, string[]> = new Map(),
): string[] {
  if (active.has(node) || active.size >= 32) return [unknownSegment];
  active.add(node);
  function declarationOf(expression: ts.Node) {
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration;
  }
  const visit = (part: ts.Node) => urlShapes(part, checker, active, bindings);
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
        const result = (expression: ts.Expression) =>
          urlShapes(expression, checker, active, callBindings);
        if (!ts.isBlock(declaration.body)) return result(declaration.body);
        const returns: string[] = [];
        function collect(part: ts.Node) {
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

function isArrayJoin(node: ts.Node): node is ts.CallExpression & {
  expression: ts.PropertyAccessExpression & {
    expression: ts.ArrayLiteralExpression;
  };
} {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join" &&
    ts.isArrayLiteralExpression(node.expression.expression)
  );
}

function violations(source: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const findings: string[] = [];
  const report = (node: ts.Node, message: string) => {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    findings.push(`${line + 1}: ${message}`);
  };
  function isRegistered(value: string) {
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
  const visit = (node: ts.Node) => {
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
  // Keep the compiler program within the worker heap. Start with complete
  // addresses and local path assembly, then add only the path-piece imports
  // those files need for aliased declarations.
  const pathPieces = /["'`]\/[^/\s]|\}\/|\.join\s*\(|\\[xu]/;
  const directPrefix = /["'`]\/api\b|\\[xu]/;
  const apiSegment = /["'`]api["'`]/;
  const localAssembly = /`[^`]*\$\{|\+|\.join\s*\(/;
  const barrel = /\bexport\s+(?:\*|\{)/;
  const cache = ts.createModuleResolutionCache(src, (file) => file, options);
  // Shared barrels recur in many import chains. Resolve each file's imports
  // once per source snapshot, without changing the roots or the checker.
  const resolvedImports = new Map<string, string[]>();
  const imports = (file: string, source: string) => {
    const previous = resolvedImports.get(file);
    if (previous) return previous;
    const resolved = ts
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
    resolvedImports.set(file, resolved);
    return resolved;
  };
  const prefixFiles = new Set<string>();
  const carriesPrefix = (file: string, seen: Set<string>): boolean => {
    if (prefixFiles.has(file)) return true;
    if (seen.has(file)) return false;
    seen.add(file);
    const source = sources.get(file);
    const carries =
      source !== undefined &&
      (/["'`]\/api\b|["'`]\/["'`]|\\[xu]/.test(source) ||
        (barrel.test(source) &&
          imports(file, source).some((item) => carriesPrefix(item, seen))));
    if (carries) prefixFiles.add(file);
    return carries;
  };
  const callsWithPrefix = (file: string, source: string): boolean => {
    if (!/\b[\w$]+\s*(?:\?\.)?\(\s*[\w$]+/.test(source)) return false;
    const prefixBindings = new Set<string>();
    for (const match of source.matchAll(
      /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g,
    )) {
      const clause = match[1]!;
      const target = ts.resolveModuleName(match[2]!, file, options, host, cache)
        .resolvedModule?.resolvedFileName;
      if (!target || !carriesPrefix(target, new Set())) continue;
      const defaultBinding = clause.match(/^\s*([A-Za-z_$][\w$]*)/);
      if (defaultBinding) prefixBindings.add(defaultBinding[1]!);
      const namespaceBinding = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
      if (namespaceBinding) prefixBindings.add(namespaceBinding[1]!);
      const namedBindings = clause.match(/\{([^}]*)\}/)?.[1];
      for (const binding of namedBindings?.split(",") ?? []) {
        const localName = binding
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .at(-1);
        if (localName && /^[A-Za-z_$][\w$]*$/.test(localName))
          prefixBindings.add(localName);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const match of source.matchAll(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\b/g,
      )) {
        if (prefixBindings.has(match[2]!) && !prefixBindings.has(match[1]!)) {
          prefixBindings.add(match[1]!);
          changed = true;
        }
      }
    }
    return [...prefixBindings].some((binding) =>
      new RegExp(
        `\\b[\\w$]+\\s*(?:\\?\\.)?\\(\\s*${binding}(?:\\b|\\s*\\()`,
      ).test(source),
    );
  };
  const roots = new Set<string>();
  const importQueue = new Set<string>();
  for (const [file, source] of sources) {
    const assemblesPath =
      pathPieces.test(source) &&
      apiSegment.test(source) &&
      localAssembly.test(source);
    const callsPrefix = callsWithPrefix(file, source);
    if (
      directPrefix.test(source) ||
      assemblesPath ||
      [...retired].some((name) => source.includes(name)) ||
      callsPrefix
    )
      roots.add(file);
    if (assemblesPath || callsPrefix) importQueue.add(file);
  }
  const importsToCheck = [...importQueue];
  for (let index = 0; index < importsToCheck.length; index++) {
    const file = importsToCheck[index]!;
    const source = sources.get(file);
    if (!source) continue;
    for (const imported of imports(file, source)) {
      const importedSource = sources.get(imported);
      if (
        importedSource &&
        !roots.has(imported) &&
        (pathPieces.test(importedSource) || barrel.test(importedSource))
      ) {
        roots.add(imported);
        if (barrel.test(importedSource)) importsToCheck.push(imported);
      }
    }
  }
  const program = ts.createProgram([...roots], options, host);
  const checker = program.getTypeChecker();
  return [...roots].flatMap((file) =>
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
        [path.join(src, "fragment.ts"), 'export const suffix = "/logo";'],
        [
          path.join(src, "segments.ts"),
          'const href = ["", "api", "traeger", "master-data", "logo"].join("/");',
        ],
        [
          path.join(src, "consumer.ts"),
          'import { base, getBase } from "./prefix";\nimport { withLogo } from "./helper";\nimport { suffix } from "./fragment";\nconst href = withLogo(base);\nconst nested = withLogo(getBase());\nconst joined = base + suffix;',
        ],
      ]),
    );
    expect(findings).toContain(
      "consumer.ts:4: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
    );
    expect(findings).toContain(
      "consumer.ts:5: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
    );
    expect(findings).toContain(
      "consumer.ts:6: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
    );
    expect(findings).toContain(
      "segments.ts:1: use the registered route key with bffPath, bffFileHref, bffJson or bffFile",
    );
  });

  it(
    "finds no retired route helpers or handwritten registered BFF addresses in production source",
    { timeout: 60_000 },
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
