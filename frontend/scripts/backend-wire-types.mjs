// Guard against hand-written wire types (#2353, #7806).
//
// Response and request shapes come from the generated contract in
// src/lib/contract/*.generated.ts. A hand-written type that copies a wire
// shape drifts from it (number IDs, fields the decoder drops). The guard
// finds such types by their form, not by their name:
//
// - shape: an interface or object type that declares at least two
//   snake_case fields of its own (a `Backend*` name: one is enough);
// - rename: a generated type imported under another name
//   (`import type { GroupResponse as GroupWire }`);
// - alias: a type that only renames a generated type
//   (`type GroupWire = groupsContract.GroupResponse`).
//
// Existing findings stand in backend-wire-types-baseline.json, one entry per
// declaration. The list only shrinks: a new finding fails, and so does an
// entry that no longer matches, so a fixed type leaves the list in the same
// change. Derived types (`Omit<generated.X, …> & { … }`) are no finding.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const BACKEND_NAME = /^Backend[A-Z]/;
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const GENERATED = /(^|\/)contract\/[^/]+\.generated(\.ts)?$/;

function propertyName(member) {
  const name = member.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

/** The snake_case fields a member list declares itself, nested ones excluded. */
function ownSnakeCaseFields(members) {
  return members
    .filter(ts.isPropertySignature)
    .map(propertyName)
    .filter((name) => name !== null && SNAKE_CASE.test(name));
}

/** The members of an interface or an object type alias, else null. */
function declaredMembers(node) {
  if (ts.isInterfaceDeclaration(node)) return node.members;
  if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
    return node.type.members;
  }
  return null;
}

/** Names bound to the generated contract in one file: types and namespaces. */
function generatedBindings(source) {
  const names = new Set();
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !GENERATED.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else for (const element of bindings.elements) names.add(element.name.text);
  }
  return { names, namespaces };
}

/** True when a type only names a generated type, without changing it. */
function isGeneratedReference(type, { names, namespaces }) {
  if (!ts.isTypeReferenceNode(type) || type.typeArguments) return false;
  const name = type.typeName;
  if (ts.isIdentifier(name)) return names.has(name.text);
  return ts.isIdentifier(name.left) && namespaces.has(name.left.text);
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
  const generated = generatedBindings(source);
  const lineOf = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const findings = [];

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      GENERATED.test(statement.moduleSpecifier.text)
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.propertyName) {
            findings.push({
              kind: "rename",
              name: element.name.text,
              line: lineOf(element),
              fields: [element.propertyName.text],
            });
          }
        }
      }
    }
  }

  const visit = (node) => {
    const members = declaredMembers(node);
    if (members) {
      const fields = ownSnakeCaseFields(members);
      const minimum = BACKEND_NAME.test(node.name.text) ? 1 : 2;
      if (fields.length >= minimum) {
        findings.push({
          kind: "shape",
          name: node.name.text,
          line: lineOf(node.name),
          fields,
        });
      }
    } else if (
      ts.isTypeAliasDeclaration(node) &&
      isGeneratedReference(node.type, generated)
    ) {
      findings.push({
        kind: "alias",
        name: node.name.text,
        line: lineOf(node.name),
        fields: [node.type.getText(source)],
      });
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
      if (entry.name !== "node_modules" && entry.name !== "test") {
        files.push(...sourceFiles(path));
      }
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".generated.ts") &&
      !entry.name.endsWith(".d.ts") &&
      !/\.(test|stories)\.tsx?$/.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files;
}

/** The baseline key of a finding: one entry per declaration. */
export function wireTypeKey(finding) {
  return `${finding.file} ${finding.kind} ${finding.name}`;
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
