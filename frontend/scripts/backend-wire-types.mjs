// Guard against hand-written wire types (#2353).
//
// Response and request shapes come from the generated contract in
// src/lib/contract/*.generated.ts. A hand-written `Backend*` interface or
// type with snake_case fields copies a wire shape the generator already
// owns, drifts from it (number IDs, fields the decoder drops), and is what
// #2353 removed. Infrastructure types that merely start with "Backend"
// (BackendCall, BackendTimeout, …) declare no snake_case field and pass.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const NAME = /^Backend[A-Z]/;
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

function propertyName(member) {
  const name = member.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

/** The snake_case property names a type node declares, nested ones included. */
function snakeCaseFields(node) {
  const found = [];
  const visit = (current) => {
    if (ts.isPropertySignature(current)) {
      const name = propertyName(current);
      if (name && SNAKE_CASE.test(name)) found.push(name);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/** Hand-written wire types in one source text. */
export function findBackendWireTypes(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = [];
  const visit = (node) => {
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      NAME.test(node.name.text)
    ) {
      const fields = snakeCaseFields(node);
      if (fields.length > 0) {
        const { line } = source.getLineAndCharacterOfPosition(
          node.name.getStart(source),
        );
        findings.push({ name: node.name.text, line: line + 1, fields });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") files.push(...sourceFiles(path));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".generated.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(path);
    }
  }
  return files;
}

/** Every hand-written wire type under `root` (default: frontend/src). */
export function scanBackendWireTypes(root) {
  return sourceFiles(root).flatMap((file) =>
    findBackendWireTypes(file, readFileSync(file, "utf8")).map((finding) => ({
      ...finding,
      file: relative(root, file),
    })),
  );
}
