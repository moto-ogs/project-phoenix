import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const frontend = new URL("../", import.meta.url).pathname;

// Mark the source declaration, then follow its symbol through the compiler.
// Moving or renaming a raw wire value must not disable this check.
function declaredOrigin(symbol) {
  for (const declaration of symbol?.declarations ?? []) {
    for (const tag of ts.getJSDocTags(declaration)) {
      if (tag.tagName.text === "rawProblemEnvelope") return "envelope";
      if (tag.tagName.text === "rawProblemDetails") return "details";
    }
  }
  return undefined;
}

function castsOfErrorBodies(program, files) {
  const checker = program.getTypeChecker();
  const envelopeFields = new Set(["type", "title", "status", "detail", "instance", "code", "errors", "details"]);
  function memberName(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    const key = checker.getTypeAtLocation(node.argumentExpression);
    return key.isStringLiteral() ? key.value : undefined;
  }
  function origin(node, seen = new Set()) {
    if (!node || seen.has(node)) return undefined;
    seen.add(node);
    if (
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAwaitExpression(node)
    ) {
      return origin(node.expression, seen);
    }
    if (ts.isBinaryExpression(node)) {
      return (
        origin(node.left, seen) ?? origin(node.right, seen)
      );
    }
    if (ts.isConditionalExpression(node)) {
      return (
        origin(node.whenTrue, seen) ?? origin(node.whenFalse, seen)
      );
    }
    if (ts.isCallExpression(node)) {
      return origin(node.expression, seen);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node);
      const symbol = name && checker.getTypeAtLocation(node.expression).getProperty(name);
      const declared = declaredOrigin(symbol);
      if (declared) return declared;
      const source = origin(node.expression, seen);
      if (source === "envelope" && name === "details") return "details";
      return source === "envelope" && envelopeFields.has(name) ? undefined : source;
    }
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = checker.getSymbolAtLocation(node);
    for (const decl of symbol?.declarations ?? []) {
      if (ts.isVariableDeclaration(decl)) {
        return origin(decl.initializer, seen);
      }
      if (ts.isBindingElement(decl)) {
        const owner = decl.parent.parent;
        if (!ts.isVariableDeclaration(owner)) continue;
        const type = checker.getTypeAtLocation(owner.initializer ?? owner);
        const key = decl.propertyName ?? decl.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key)) {
          const declared = declaredOrigin(type.getProperty(key.text));
          if (declared) return declared;
          const source = origin(owner.initializer, seen);
          if (source === "envelope" && key.text === "details") return "details";
          return source === "envelope" && envelopeFields.has(key.text) ? undefined : source;
        }
      }
    }
    return undefined;
  }

  function bindingReadsPayload(node) {
    if (!ts.isBindingElement(node)) return false;
    const owner = node.parent.parent;
    if (!ts.isVariableDeclaration(owner)) return false;
    const source = origin(owner.initializer);
    if (source === "details") return true;
    if (source !== "envelope") return false;
    const key = node.propertyName ?? node.name;
    return node.dotDotDotToken ||
      (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) ||
      !envelopeFields.has(key.text);
  }

  const findings = [];
  for (const file of files) {
    function visit(node) {
      const access = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
      const input = access ? origin(node.expression) : undefined;
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        origin(node.expression) ||
        input === "details" ||
        (input === "envelope" && !envelopeFields.has(memberName(node))) ||
        bindingReadsPayload(node) ||
        (ts.isSpreadAssignment(node) && origin(node.expression) === "details")
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

test("rejects casts and members of aliased error payloads, not local values", () => {
  const fileName = join(tmpdir(), "phoenix-error-body-cast-probe.ts");
  const options = { noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === fileName
    ? ts.createSourceFile(name, [
        "class Failure {",
        "  /** @rawProblemDetails */ declare data: unknown;",
        "  /** @rawProblemEnvelope */ declare response: unknown;",
        "}",
        "const e = new Failure();",
        "const raw = e['data'];",
        "const copy = raw;",
        "const invalid = copy as { changed: boolean };",
        "const local = { details: 4 };",
        "const valid = local.details as number;",
        "const { data: payload } = e;",
        "const key = 'matches';",
        "const invalidRead = payload[key];",
        "const envelope = e.response;",
        "const misplaced = envelope.blockers;",
        "const { warnings } = envelope;",
        "const { matches: list } = copy;",
        "const copiedMembers = { ...copy };",
      ].join("\n"), ts.ScriptTarget.Latest, true)
    : undefined;
  const program = ts.createProgram([fileName], options, host);
  assert.deepEqual(
    castsOfErrorBodies(program, program.getSourceFiles()),
    [8, 13, 15, 16, 17, 18].map((line) => `${fileName}:${line}`),
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
