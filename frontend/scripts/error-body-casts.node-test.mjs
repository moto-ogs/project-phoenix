import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const frontend = new URL("../", import.meta.url).pathname;
const declarations = new Map([
  [join(frontend, "src/lib/api-error.ts"), new Set(["problem", "details"])],
  [join(frontend, "src/lib/api-response-error.server.ts"), new Set(["body"])],
]);

function castsOfErrorBodies(program, files, sources = declarations) {
  const checker = program.getTypeChecker();
  function originatesFromErrorBody(node, seen) {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAwaitExpression(node)
    ) {
      return originatesFromErrorBody(node.expression, seen);
    }
    if (ts.isBinaryExpression(node)) {
      return (
        originatesFromErrorBody(node.left, seen) ||
        originatesFromErrorBody(node.right, seen)
      );
    }
    if (ts.isConditionalExpression(node)) {
      return (
        originatesFromErrorBody(node.whenTrue, seen) ||
        originatesFromErrorBody(node.whenFalse, seen)
      );
    }
    if (ts.isCallExpression(node)) {
      return originatesFromErrorBody(node.expression, seen);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol?.declarations?.some((decl) =>
        (ts.isPropertyDeclaration(decl) || ts.isMethodDeclaration(decl)) &&
        sources.get(decl.getSourceFile().fileName)?.has(symbol.name),
      )) return true;
      return originatesFromErrorBody(node.expression, seen);
    }
    if (!ts.isIdentifier(node)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    return !!symbol?.declarations?.some((decl) => {
      if (ts.isVariableDeclaration(decl)) {
        return originatesFromErrorBody(decl.initializer, seen);
      }
      if (ts.isBindingElement(decl)) {
        const owner = decl.parent.parent;
        return ts.isVariableDeclaration(owner) &&
          originatesFromErrorBody(owner.initializer, seen);
      }
      return false;
    });
  }

  const findings = [];
  for (const file of files) {
    function visit(node) {
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        originatesFromErrorBody(node.expression, new Set())
      ) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        findings.push(`${file.fileName}:${line + 1}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return findings;
}

test("detects an aliased, indexed error body but not another object's details", () => {
  const fileName = join(tmpdir(), "phoenix-error-body-cast-probe.ts");
  const options = { noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === fileName
    ? ts.createSourceFile(name, [
        "class ApiError { declare details: unknown; }",
        "const e = new ApiError();",
        "const raw = e['details'];",
        "const copy = raw;",
        "const invalid = copy as { changed: boolean };",
        "const local = { details: 4 };",
        "const valid = local.details as number;",
      ].join("\n"), ts.ScriptTarget.Latest, true)
    : undefined;
  const program = ts.createProgram([fileName], options, host);
  assert.deepEqual(
    castsOfErrorBodies(program, program.getSourceFiles(), new Map([[fileName, new Set(["details"])]])),
    [`${fileName}:5`],
  );
});

test("the frontend decodes error bodies instead of asserting their type", () => {
  const config = join(frontend, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  assert.ok(parsed);
  const production = parsed.fileNames.filter((name) =>
    name.startsWith(join(dirname(config), "src/")) &&
    !/([.]test[.]|[.]stories[.]|[.]generated[.]|\/__tests__\/|\/test\/)/.test(name),
  );
  const program = ts.createProgram(production, parsed.options);
  const files = production.map((file) => program.getSourceFile(file)).filter(Boolean);
  assert.deepEqual(castsOfErrorBodies(program, files), []);
});
