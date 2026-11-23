import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A portal forwards its backend routes through one catalog proxy (#2352,
 * ADR 0270). A `route.ts` whose only top-level code is
 * `export const METHOD = proxyX(endpoint, options?)` has no place any more:
 * register the backend route in the contract instead
 * (docs/agents/frontend-api.md, "Generated contract"). A route with code of
 * its own (session, upload, file answer, stream) is not affected.
 */

const appDir = path.resolve(__dirname, "..");
const PROXY_CALL = /^proxy(Get|Post|Put|Patch|Delete)$/;

/** A literal path or a one-expression builder; builders with own logic keep their own tests. */
function isPlainEndpoint(endpoint: ts.Expression | undefined): boolean {
  if (!endpoint) return false;
  if (ts.isArrowFunction(endpoint)) return !ts.isBlock(endpoint.body);
  return (
    ts.isStringLiteral(endpoint) || ts.isNoSubstitutionTemplateLiteral(endpoint)
  );
}

/** True when every top-level statement is an import, a type, or an exported proxy call. */
function isPureProxyRoute(file: string): boolean {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let proxies = 0;
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      continue;
    }
    const exported =
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) return false;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (
        !init ||
        !ts.isCallExpression(init) ||
        !PROXY_CALL.test(init.expression.getText(source)) ||
        !isPlainEndpoint(init.arguments[0])
      ) {
        return false;
      }
      proxies++;
    }
  }
  return proxies > 0;
}

const pureRoutes = readdirSync(appDir, { recursive: true, encoding: "utf8" })
  .filter((file) => path.basename(file) === "route.ts")
  .filter((file) => isPureProxyRoute(path.join(appDir, file)))
  .map((file) => path.dirname(file))
  .sort();

describe("pure proxy routes", () => {
  // The detector finds a pass-through file and passes over a route with code
  // of its own.
  it.each([
    [
      'import { proxyGet } from "~/lib/route-wrapper.server";\nexport const GET = proxyGet("/api/x");\n',
      true,
    ],
    [
      'import { proxyGet } from "~/lib/route-wrapper.server";\nconst x = 1;\nexport const GET = proxyGet(`/api/${x}`);\n',
      false,
    ],
  ])("detects a pass-through route file (%#)", (source, pure) => {
    const directory = mkdtempSync(path.join(tmpdir(), "phoenix-proxy-route-"));
    try {
      const file = path.join(directory, "route.ts");
      writeFileSync(file, source);
      expect(isPureProxyRoute(file)).toBe(pure);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("finds no pass-through route file", () => {
    expect(pureRoutes).toEqual([]);
  });
});
