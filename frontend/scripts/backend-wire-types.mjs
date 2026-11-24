// Guard against hand-written wire types (#2353, #7806).
//
// Response and request shapes come from the generated contract in
// src/lib/contract/*.generated.ts. A hand-written type that copies a wire
// shape drifts from it (number IDs, fields the decoder drops). The guard
// finds such types by their form, not by their name:
//
// - shape: an interface, object type or union branch that declares at least two
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

/** Object branches only; nested property types are not separate declarations. */
function objectBranches(type) {
  if (ts.isTypeLiteralNode(type)) return [type.members];
  if (ts.isParenthesizedTypeNode(type)) return objectBranches(type.type);
  if (ts.isUnionTypeNode(type)) return type.types.flatMap(objectBranches);
  return [];
}

function declaredMembers(node) {
  if (ts.isInterfaceDeclaration(node)) return [node.members];
  if (ts.isTypeAliasDeclaration(node)) return objectBranches(node.type);
  return [];
}

function declaredBranch(node) {
  let parent = node.parent;
  while (ts.isParenthesizedTypeNode(parent) || ts.isUnionTypeNode(parent)) {
    parent = parent.parent;
  }
  return ts.isTypeAliasDeclaration(parent);
}

// A named projection with an intersection transforms a base type; it is not
// an independently declared wire shape. Inline casts and other use sites do
// not get this exemption, even when their type is an intersection.
function namedProjection(node, generated) {
  const parent = node.parent;
  if (!ts.isIntersectionTypeNode(parent)) return false;
  let owner = parent.parent;
  while (ts.isParenthesizedTypeNode(owner) || ts.isUnionTypeNode(owner)) {
    owner = owner.parent;
  }
  if (!ts.isTypeAliasDeclaration(owner) && !(ts.isPropertySignature(owner) && ts.isInterfaceDeclaration(owner.parent))) return false;
  return parent.types.some((part) =>
    derivedType(part, node.getSourceFile(), generated),
  );
}

function derivedType(type, source, generated, seen = new Set()) {
  if (ts.isParenthesizedTypeNode(type))
    return derivedType(type.type, source, generated, seen);
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
    return type.types.some((part) =>
      derivedType(part, source, generated, seen),
    );
  }
  if (!ts.isTypeReferenceNode(type)) return false;
  if (isGeneratedReference(type, generated)) return true;
  if (!ts.isIdentifier(type.typeName)) return false;
  const name = type.typeName.text;
  if (["Omit", "Pick", "Partial", "Required", "Readonly"].includes(name)) {
    const base = type.typeArguments?.[0];
    return base !== undefined && derivedType(base, source, generated, seen);
  }
  if (seen.has(name)) return false;
  seen.add(name);
  const alias = source.statements.find(
    (statement) =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
  );
  return (
    alias !== undefined && derivedType(alias.type, source, generated, seen)
  );
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
    if (members.length) {
      const minimum = BACKEND_NAME.test(node.name.text) ? 1 : 2;
      const fields = [
        ...new Set(
          members
            .map(ownSnakeCaseFields)
            .filter((fields) => fields.length >= minimum)
            .flat(),
        ),
      ];
      if (fields.length) {
        findings.push({
          kind: "shape",
          name: node.name.text,
          line: lineOf(node.name),
          fields,
        });
      }
    } else if (
      ts.isTypeLiteralNode(node) &&
      !declaredBranch(node) &&
      !namedProjection(node, generated)
    ) {
      const fields = ownSnakeCaseFields(node.members);
      if (fields.length >= 2) {
        findings.push({
          kind: "shape",
          name: `inline:${fields.join(",")}`,
          line: lineOf(node),
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
