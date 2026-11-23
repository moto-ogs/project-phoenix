import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, resolve } from "node:path";
import { API, SymbolFlags, TypeFlags } from "typescript-native/unstable/sync";
import { NodeFlags, SyntaxKind } from "typescript-native/unstable/ast";
import * as ast from "typescript-native/unstable/ast/is";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const tsconfig = resolve(frontend, "tsconfig.json");
const contractFile = new URL(
  "../../backend/api/contract/contract.json",
  import.meta.url,
);

let project;
let wireTypes;

function openProject(api, openFiles) {
  const snapshot = api.updateSnapshot({ openProjects: [tsconfig], openFiles });
  const project = openFiles?.length
    ? (snapshot.getDefaultProjectForFile(openFiles[0]) ??
      snapshot.getProject(tsconfig))
    : snapshot.getProject(tsconfig);
  if (!project)
    throw new Error("Could not open frontend tsconfig for identifier lint.");
  return project;
}

function createProject() {
  const api = new API();
  process.once("beforeExit", () => api.close());
  return openProject(api);
}

function wireField(schema) {
  if (schema.kind === "id") return "id";
  if (schema.kind === "array")
    return wireField(schema.elem) === "id" ? "id-list" : "other";
  return "other";
}

function declaredKind(type, checker, seen) {
  if (!type) return;
  if (ast.isParenthesizedTypeNode(type))
    return declaredKind(type.type, checker, seen);
  if (ast.isUnionTypeNode(type)) {
    let known;
    for (const member of type.types) {
      const kind = declaredKind(member, checker, seen);
      if (kind === "id" || kind === "id-list") return kind;
      known ??= kind;
    }
    return known;
  }
  if (
    ast.isIndexedAccessTypeNode(type) &&
    ast.isLiteralTypeNode(type.indexType) &&
    ast.isStringLiteral(type.indexType.literal)
  ) {
    const object = checker.getTypeFromTypeNode(type.objectType);
    if (object)
      return contractKind(
        checker.getPropertyOfType(object, type.indexType.literal.text),
        checker,
        seen,
      );
  }
  if (ast.isTypeReferenceNode(type)) {
    const symbol = checker.getSymbolAtLocation(type.typeName);
    return contractKind(symbol, checker, seen);
  }
}

function contractKind(symbol, checker, seen = new Set()) {
  if (!symbol || seen.has(symbol.id)) return;
  seen.add(symbol.id);
  if (symbol.flags & SymbolFlags.Alias) {
    return contractKind(checker.getAliasedSymbol(symbol), checker, seen);
  }

  for (const handle of symbol.declarations) {
    // Dependencies cannot reference this app's generated contract.
    if (handle.path.includes("/node_modules/")) continue;
    if (
      ![
        SyntaxKind.PropertySignature,
        SyntaxKind.PropertyAssignment,
        SyntaxKind.ShorthandPropertyAssignment,
        SyntaxKind.Parameter,
        SyntaxKind.VariableDeclaration,
        SyntaxKind.TypeAliasDeclaration,
      ].includes(handle.kind)
    )
      continue;
    const declaration = handle.resolve();
    if (!declaration) continue;
    if (ast.isShorthandPropertyAssignment(declaration)) {
      const kind = contractKind(
        checker.getShorthandAssignmentValueSymbol(declaration),
        checker,
        seen,
      );
      if (kind) return kind;
      continue;
    }
    if (
      ast.isPropertyAssignment(declaration) ||
      (ast.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        declaration.parent.flags & NodeFlags.Const)
    ) {
      const inferred = expressionKind(declaration.initializer, checker, seen);
      if (inferred) return inferred;
    }

    // The generator emits IDs as string in TS; the matching contract node is
    // the authoritative distinction from another string on the same object.
    if (
      handle.kind === SyntaxKind.PropertySignature &&
      /[\\/]lib[\\/]contract[\\/][^\\/]+\.generated\.ts$/.test(handle.path) &&
      ast.isInterfaceDeclaration(declaration.parent)
    ) {
      const kind = generatedFieldKind(declaration.parent, symbol.name);
      if (kind) return kind;
    }
    const annotated = declaredKind(declaration.type, checker, seen);
    if (annotated) return annotated;
  }
}

function generatedFieldKind(interfaceNode, field) {
  if (!wireTypes) {
    const { types, routes } = JSON.parse(readFileSync(contractFile, "utf8"));
    wireTypes = new Map(
      types.map((type) => [
        type.name,
        new Map(
          type.fields.map((field) => [field.name, wireField(field.schema)]),
        ),
      ]),
    );
    for (const route of routes) {
      if (route.query)
        wireTypes.set(
          `${route.method} ${route.pattern}`,
          new Map(
            route.query.map((param) => [
              param.name,
              param.kind === "id"
                ? param.repeated
                  ? "id-list"
                  : "id"
                : "other",
            ]),
          ),
        );
    }
  }
  // TS's RPC AST represents JSDoc prose as a list of JSDocText nodes.
  const annotation = interfaceNode.jsDoc?.[0]?.comment;
  const query =
    typeof annotation === "string"
      ? annotation
      : annotation?.map((part) => part.text).join("");
  const key = query?.startsWith("Query of ")
    ? query.slice("Query of ".length)
    : interfaceNode.name.text;
  return wireTypes.get(key)?.get(field);
}

const ID_SUFFIX = /(?:Id|Ids|ID|IDs|_id|_ids)$/;

function looksLikeIdentifier(name) {
  return /^(?:id|ids)$/i.test(name) || ID_SUFFIX.test(name);
}

function numericOrBoolean(type, checker, inspectElements = true) {
  if (!type) return false;
  if (type.isUnionType()) {
    const present = type
      .getTypes()
      .filter((part) => !(part.flags & (TypeFlags.Null | TypeFlags.Undefined)));
    return (
      present.length > 0 &&
      present.every((part) => numericOrBoolean(part, checker, inspectElements))
    );
  }
  if (
    type.flags &
    (TypeFlags.NumberLike | TypeFlags.BigIntLike | TypeFlags.BooleanLike)
  )
    return true;
  return (
    inspectElements &&
    Boolean(type.flags & TypeFlags.Object) &&
    checker
      .getIndexInfosOfType(type)
      .some(
        ({ keyType, valueType: element }) =>
          keyType.flags & TypeFlags.NumberLike &&
          numericOrBoolean(element, checker, false),
      )
  );
}

function expressionKind(node, checker, seen = new Set()) {
  if (seen.has(node)) return;
  seen.add(node);
  if (
    ast.isParenthesizedExpression(node) ||
    ast.isNonNullExpression(node) ||
    ast.isAssertionExpression(node) ||
    ast.isSatisfiesExpression(node)
  ) {
    return expressionKind(node.expression, checker, seen);
  }
  const alternatives = ast.isConditionalExpression(node)
    ? [node.whenTrue, node.whenFalse]
    : ast.isBinaryExpression(node) &&
        [
          SyntaxKind.QuestionQuestionToken,
          SyntaxKind.BarBarToken,
          SyntaxKind.AmpersandAmpersandToken,
        ].includes(node.operatorToken.kind)
      ? [node.left, node.right]
      : null;
  if (alternatives) {
    const kinds = alternatives.map((part) =>
      expressionKind(part, checker, seen),
    );
    return (
      kinds.find((kind) => kind === "id" || kind === "id-list") ??
      kinds.find(Boolean)
    );
  }
  if (
    ast.isElementAccessExpression(node) &&
    expressionKind(node.expression, checker, seen) === "id-list"
  )
    return "id";

  const name = ast.isPropertyAccessExpression(node)
    ? node.name
    : ast.isElementAccessExpression(node)
      ? node.argumentExpression
      : node;
  const symbol = checker.getSymbolAtLocation(name);
  const fromContract = contractKind(symbol, checker, seen);
  if (fromContract) return fromContract;

  // The generated TypeScript represents both IDs and ordinary strings as
  // string. Follow local aliases back to the schema, not their spelling.
  if (ast.isIdentifier(node)) {
    const declaration = symbol?.valueDeclaration?.resolve();
    if (
      declaration &&
      ast.isBindingElement(declaration) &&
      ast.isObjectBindingPattern(declaration.parent)
    ) {
      const property = declaration.propertyName ?? declaration.name;
      if (ast.isIdentifier(property) || ast.isStringLiteral(property)) {
        const objectType = checker.getTypeAtLocation(declaration.parent);
        const fromBinding =
          objectType &&
          contractKind(
            checker.getPropertyOfType(objectType, property.text),
            checker,
          );
        if (fromBinding) return fromBinding;
        if (looksLikeIdentifier(property.text)) {
          return numericOrBoolean(checker.getTypeAtLocation(node), checker)
            ? "other"
            : "id";
        }
      }
    }
  }

  if (
    (ast.isIdentifier(name) || ast.isStringLiteral(name)) &&
    looksLikeIdentifier(name.text)
  ) {
    return numericOrBoolean(checker.getTypeAtLocation(node), checker)
      ? "other"
      : "id";
  }
}

// Resolve only the expressions selected by oxlint. Plain numeric and boolean
// fields are not identifiers just because they happen to be called "id".
export function numericIdentifiers(file, text, operands) {
  const filename = resolve(file);
  // Probes for unrelated plugins also load the repo config, but lint files
  // in isolated temporary roots. Only this project's code has our wire types.
  if (!filename.startsWith(frontend)) return [];
  project ??= createProject();
  const source = project.program.getSourceFile(file);
  if (source?.text === text)
    return findIdentifiers(source, project.checker, operands);

  // Editor buffers can differ from disk. Type-check the same source Oxlint
  // linted, without making the ordinary CLI path use a virtual filesystem.
  const parent = dirname(filename);
  const fileExists = (path) => path === filename || undefined;
  const readFile = (path) => (path === filename ? text : undefined);
  const fs = { fileExists, readFile };
  if (!source) {
    // Include a new buffer in tsconfig's glob before it has a disk entry.
    fs.getAccessibleEntries = (path) => {
      if (path !== parent) return;
      const entries = readdirSync(parent, { withFileTypes: true });
      return {
        files: [
          ...new Set([
            basename(filename),
            ...entries
              .filter((entry) => !entry.isDirectory())
              .map((entry) => entry.name),
          ]),
        ],
        directories: entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name),
      };
    };
  }
  const api = new API({ fs });
  try {
    const current = openProject(api, [filename]);
    const buffer = current.program.getSourceFile(file);
    return buffer?.text === text
      ? findIdentifiers(buffer, current.checker, operands)
      : [];
  } finally {
    api.close();
  }
}

function findIdentifiers(source, checker, operands) {
  function visit(node) {
    const start = node.getStart(source);
    const operand = operands.get(start);
    if (operand && node.end === operand.range[1]) {
      const kind = expressionKind(node, checker);
      if (kind === "id" || kind === "id-list") identifiers.push(operand);
    }
    if (
      positions.some((position) => position >= start && position < node.end)
    ) {
      node.forEachChild(visit);
    }
  }

  const positions = [...operands.keys()];
  const identifiers = [];
  visit(source);
  return identifiers;
}
