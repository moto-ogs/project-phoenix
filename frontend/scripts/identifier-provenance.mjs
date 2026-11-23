import { hash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const frontend = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = resolve(frontend, "src") + sep;
const tsconfig = resolve(frontend, "tsconfig.json");
const contractFile = new URL(
  "../../backend/api/contract/contract.json",
  import.meta.url,
);

let ts;
let config;
let project;
let wireTypes;
let wireContractText;
let editorSnapshot;

const inEditor = process.argv.includes("--lsp");
const generatedContractPath =
  /[\\/]lib[\\/]contract[\\/][^\\/]+\.generated\.ts$/;

// Checking just the files in the program misses module resolution changes.
// Record the compiler's directory listings, symlink resolutions and failed
// lookup probes as well as the contents it actually loaded.
const compilerInputs = [
  "fileExists",
  "directoryExists",
  "getDirectories",
  "readDirectory",
  "readFile",
  "realpath",
  "getEnvironmentVariable",
];

function inputValue(method, result) {
  if (method === "readFile" && result !== undefined)
    return hash("sha256", result);
  return Array.isArray(result) ? JSON.stringify(result) : (result ?? null);
}

function observeInputs(host, snapshot) {
  for (const method of compilerInputs) {
    if (!host[method]) continue;
    const original = host[method];
    const inputs = snapshot.inputs.get(method) ?? new Map();
    snapshot.inputs.set(method, inputs);
    host[method] = (...args) => {
      const result = original(...args);
      const key = method === "readDirectory" ? JSON.stringify(args) : args[0];
      const value = inputValue(method, result);
      if (inputs.has(key) && inputs.get(key) !== value) snapshot.changed = true;
      inputs.set(key, value);
      return result;
    };
  }
  return host;
}

function inputsStillMatch(observations) {
  try {
    for (const [method, inputs] of observations) {
      if (!compilerInputs.includes(method)) return false;
      for (const [key, value] of inputs) {
        const args =
          method === "readDirectory"
            ? JSON.parse(key).map((arg) => arg ?? undefined)
            : [key];
        if (inputValue(method, ts.sys[method](...args)) !== value) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function currentEditorInputs() {
  if (!inEditor) return;
  if (
    editorSnapshot &&
    (editorSnapshot.changed ||
      !inputsStillMatch(editorSnapshot.inputs) ||
      (wireContractText !== undefined &&
        readFileSync(contractFile, "utf8") !== wireContractText))
  ) {
    // Unchanged buffer text is not a version for its imported types.
    config =
      project =
      wireTypes =
      wireContractText =
      editorSnapshot =
        undefined;
  }
  return (editorSnapshot ??= { inputs: new Map(), changed: false });
}

function lintConfig(snapshot) {
  const host = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      );
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfig,
    {},
    snapshot ? observeInputs(host, snapshot) : host,
  );
  const declarations = parsed.fileNames.filter((file) =>
    /\.d\.[cm]?ts$/.test(file),
  );
  const sources = parsed.fileNames.filter(
    (file) =>
      resolve(file).startsWith(sourceRoot) &&
      !resolve(file).startsWith(sourceRoot + "test" + sep) &&
      !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(file),
  );
  return {
    options: parsed.options,
    declarations,
    roots: [...new Set([...declarations, ...sources])],
  };
}

function createProgram(
  rootNames,
  { filename, text, oldProgram, snapshot } = {},
) {
  const options = config.options;
  const host = ts.createCompilerHost(options);
  host.jsDocParsingMode = ts.JSDocParsingMode.ParseForTypeInfo;
  if (snapshot) observeInputs(host, snapshot);
  const diskSource = host.getSourceFile.bind(host);
  const isBuffer = (path) =>
    filename !== undefined && resolve(path) === filename;
  if (filename) {
    // LSP buffers may not be saved yet. Supply the exact linted text as a
    // root; imports still resolve against the normal project.
    const diskExists = host.fileExists.bind(host);
    const diskRead = host.readFile.bind(host);
    host.fileExists = (path) => isBuffer(path) || diskExists(path);
    host.readFile = (path) => (isBuffer(path) ? text : diskRead(path));
  }
  host.getSourceFile = (path, languageVersion, ...args) => {
    // The generated query JSDoc carries the route key, not a TS type tag.
    if (generatedContractPath.test(path)) {
      const options =
        typeof languageVersion === "object"
          ? languageVersion
          : { languageVersion };
      languageVersion = {
        ...options,
        jsDocParsingMode: ts.JSDocParsingMode.ParseAll,
      };
    }
    if (isBuffer(path))
      return ts.createSourceFile(path, text, languageVersion, true);
    const previous = oldProgram?.getSourceFile(path);
    if (previous && previous.text === host.readFile(path)) return previous;
    return diskSource(path, languageVersion, ...args);
  };
  return ts.createProgram({ rootNames, options, host, oldProgram });
}

function wireField(schema) {
  if (schema.kind === "id") return "id";
  if (schema.kind === "array")
    return wireField(schema.elem) === "id" ? "id-list" : "other";
  return "other";
}

function declaredKind(type, checker, seen) {
  if (!type) return;
  if (ts.isParenthesizedTypeNode(type))
    return declaredKind(type.type, checker, seen);
  if (
    ts.isTypeOperatorNode(type) &&
    type.operator === ts.SyntaxKind.ReadonlyKeyword
  )
    return declaredKind(type.type, checker, seen);
  if (ts.isArrayTypeNode(type))
    return declaredCollectionKind(type.elementType, checker, seen);
  if (ts.isUnionTypeNode(type)) {
    let known;
    for (const member of type.types) {
      const kind = declaredKind(member, checker, seen);
      if (kind === "id" || kind === "id-list") return kind;
      known ??= kind;
    }
    return known;
  }
  if (
    ts.isIndexedAccessTypeNode(type) &&
    ts.isLiteralTypeNode(type.indexType) &&
    ts.isStringLiteral(type.indexType.literal)
  ) {
    const object = checker.getTypeFromTypeNode(type.objectType);
    if (object)
      return contractKind(
        checker.getPropertyOfType(object, type.indexType.literal.text),
        checker,
        seen,
      );
  }
  if (ts.isTypeReferenceNode(type)) {
    const [element] = type.typeArguments ?? [];
    if (element && checker.isArrayType(checker.getTypeFromTypeNode(type))) {
      return declaredCollectionKind(element, checker, seen);
    }
    const symbol = checker.getSymbolAtLocation(type.typeName);
    return contractKind(symbol, checker, seen);
  }
}

function declaredCollectionKind(element, checker, seen) {
  const kind = declaredKind(element, checker, seen);
  return kind === "id" ? "id-list" : kind;
}

function contractKind(symbol, checker, seen = new Set()) {
  if (!symbol || seen.has(symbol)) return;
  seen.add(symbol);
  if (symbol.flags & ts.SymbolFlags.Alias) {
    return contractKind(checker.getAliasedSymbol(symbol), checker, seen);
  }

  for (const declaration of symbol.declarations ?? []) {
    // Dependencies cannot reference this app's generated contract.
    const path = declaration.getSourceFile().fileName;
    if (path.includes("/node_modules/")) continue;
    if (
      ![
        ts.SyntaxKind.PropertySignature,
        ts.SyntaxKind.PropertyAssignment,
        ts.SyntaxKind.ShorthandPropertyAssignment,
        ts.SyntaxKind.Parameter,
        ts.SyntaxKind.VariableDeclaration,
        ts.SyntaxKind.TypeAliasDeclaration,
      ].includes(declaration.kind)
    )
      continue;
    if (ts.isShorthandPropertyAssignment(declaration)) {
      const kind = contractKind(
        checker.getShorthandAssignmentValueSymbol(declaration),
        checker,
        seen,
      );
      if (kind) return kind;
      continue;
    }
    if (
      ts.isPropertyAssignment(declaration) ||
      (ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        declaration.parent.flags & ts.NodeFlags.Const)
    ) {
      const inferred = expressionKind(declaration.initializer, checker, seen);
      if (inferred) return inferred;
    }

    // The generator emits IDs as string in TS; the matching contract node is
    // the authoritative distinction from another string on the same object.
    if (
      declaration.kind === ts.SyntaxKind.PropertySignature &&
      generatedContractPath.test(path) &&
      ts.isInterfaceDeclaration(declaration.parent)
    ) {
      const kind = generatedFieldKind(declaration.parent, symbol.name);
      if (kind) return kind;
    }
    const annotated = declaredKind(declaration.type, checker, seen);
    if (annotated) return annotated;
  }
}

function readContract() {
  return (wireContractText ??= readFileSync(contractFile, "utf8"));
}

function generatedFieldKind(interfaceNode, field) {
  if (!wireTypes) {
    const { types, routes } = JSON.parse(readContract());
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
  const query = interfaceNode.jsDoc?.[0]?.comment;
  const key =
    typeof query === "string" && query.startsWith("Query of ")
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
  if (type.isUnion()) {
    const present = type.types.filter(
      (part) => !(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)),
    );
    return (
      present.length > 0 &&
      present.every((part) => numericOrBoolean(part, checker, inspectElements))
    );
  }
  if (
    type.flags &
    (ts.TypeFlags.NumberLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.BooleanLike)
  )
    return true;
  return (
    inspectElements &&
    Boolean(type.flags & ts.TypeFlags.Object) &&
    checker
      .getIndexInfosOfType(type)
      .some(
        ({ keyType, type: element }) =>
          keyType.flags & ts.TypeFlags.NumberLike &&
          numericOrBoolean(element, checker, false),
      )
  );
}

const arrayCallbacks = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
  "forEach",
  "map",
  "some",
]);
const arrayComparators = new Set(["sort", "toSorted"]);
const arrayReducers = new Set(["reduce", "reduceRight"]);
const arrayElementMethods = new Set(["at", "find", "findLast", "pop", "shift"]);
const arraySubsetMethods = new Set([
  "filter",
  "reverse",
  "slice",
  "sort",
  "toReversed",
  "toSorted",
]);

function methodName(method) {
  if (ts.isPropertyAccessExpression(method)) return method.name.text;
  if (
    ts.isElementAccessExpression(method) &&
    ts.isStringLiteralLike(method.argumentExpression)
  )
    return method.argumentExpression.text;
}

function isArray(collection, checker) {
  return checker.isArrayType(
    checker.getNonNullableType(checker.getTypeAtLocation(collection)),
  );
}

function callbackElementKind(parameter, checker, seen) {
  const callback = parameter.parent;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
    return;
  const call = callback.parent;
  if (!ts.isCallExpression(call)) return;
  const method = call.expression;
  const name = methodName(method);
  if (!name) return;
  const receiver = method.expression;
  if (
    name === "from" &&
    call.arguments[1] === callback &&
    callback.parameters[0] === parameter &&
    ts.isIdentifier(receiver) &&
    receiver.text === "Array" &&
    checker.getSymbolAtLocation(receiver) ===
      checker.resolveName("Array", undefined, ts.SymbolFlags.Value, false)
  )
    return collectionElementKind(call.arguments[0], checker, seen);

  if (
    call.arguments[0] === callback &&
    ((arrayCallbacks.has(name) && callback.parameters[0] === parameter) ||
      (arrayComparators.has(name) &&
        (callback.parameters[0] === parameter ||
          callback.parameters[1] === parameter)) ||
      (arrayReducers.has(name) && callback.parameters[1] === parameter)) &&
    isArray(receiver, checker)
  )
    return collectionElementKind(receiver, checker, seen);
}

function collectionElementKind(collection, checker, seen, rest = false) {
  const kind = expressionKind(collection, checker, seen);
  if (kind === "id-list") return rest ? "id-list" : "id";
  if (kind === "other") return kind;
}

function isArrayIndex(index, checker) {
  const type = checker.getTypeAtLocation(index);
  const types = type.isUnion() ? type.types : [type];
  if (
    types.some(
      (part) =>
        (!(part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Never)) &&
          checker.isTypeAssignableTo(part, checker.getNumberType())) ||
        (part.isStringLiteral() && /^(?:0|[1-9]\d*)$/.test(part.value)),
    )
  )
    return true;

  // TypeScript also allows an array's for-in key as an index, although
  // the variable's public type is string. Do not override a narrowed key
  // or assume a dictionary's named properties are array indexes.
  if (!types.some((part) => part.flags & ts.TypeFlags.String)) return false;
  const key = ts.skipParentheses(index);
  if (!ts.isIdentifier(key)) return false;
  const symbol = checker.getSymbolAtLocation(key);
  if (!symbol) return false;
  for (
    let child = index, parent = index.parent;
    parent;
    child = parent, parent = parent.parent
  ) {
    if (!ts.isForInStatement(parent) || child !== parent.statement) continue;
    const initializer = parent.initializer;
    const target = ts.isVariableDeclarationList(initializer)
      ? initializer.declarations[0]?.name
      : initializer;
    if (!target || !ts.isIdentifier(target)) continue;
    if (checker.getSymbolAtLocation(target) !== symbol) continue;
    const collection = checker.getTypeAtLocation(parent.expression);
    if (checker.isArrayType(collection) || checker.isTupleType(collection))
      return true;
  }
  return false;
}

function expressionKind(node, checker, seen = new Set()) {
  if (seen.has(node)) return;
  seen.add(node);
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return expressionKind(node.expression, checker, seen);
  }
  const alternatives = ts.isConditionalExpression(node)
    ? [node.whenTrue, node.whenFalse]
    : ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
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
    ts.isElementAccessExpression(node) &&
    expressionKind(node.expression, checker, seen) === "id-list" &&
    isArrayIndex(node.argumentExpression, checker)
  )
    return "id";
  if (ts.isCallExpression(node)) {
    const method = node.expression;
    const name = methodName(method);
    if (
      (arrayElementMethods.has(name) || arraySubsetMethods.has(name)) &&
      isArray(method.expression, checker)
    )
      return collectionElementKind(
        method.expression,
        checker,
        seen,
        arraySubsetMethods.has(name),
      );
  }

  const name = ts.isPropertyAccessExpression(node)
    ? node.name
    : ts.isElementAccessExpression(node)
      ? node.argumentExpression
      : node;
  const symbol = checker.getSymbolAtLocation(name);
  const fromContract = contractKind(symbol, checker, seen);
  if (fromContract) return fromContract;

  // The generated TypeScript represents both IDs and ordinary strings as
  // string. Follow local aliases back to the schema, not their spelling.
  if (ts.isIdentifier(node)) {
    const declaration = symbol?.valueDeclaration;
    if (declaration && ts.isParameter(declaration)) {
      const element = callbackElementKind(declaration, checker, seen);
      if (element) return element;
    }
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      ts.isForOfStatement(declaration.parent.parent)
    ) {
      const element = collectionElementKind(
        declaration.parent.parent.expression,
        checker,
        seen,
      );
      if (element) return element;
    }
    if (
      declaration &&
      ts.isBindingElement(declaration) &&
      ts.isArrayBindingPattern(declaration.parent) &&
      ts.isVariableDeclaration(declaration.parent.parent)
    ) {
      const collection = declaration.parent.parent.initializer;
      const element =
        collection &&
        collectionElementKind(
          collection,
          checker,
          seen,
          Boolean(declaration.dotDotDotToken),
        );
      if (element) return element;
    }
    if (
      declaration &&
      ts.isBindingElement(declaration) &&
      ts.isObjectBindingPattern(declaration.parent)
    ) {
      const property = declaration.propertyName ?? declaration.name;
      if (ts.isIdentifier(property) || ts.isStringLiteral(property)) {
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
    (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
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
  // Most lint probes never need a project. Load TypeScript only when this
  // rule finds an operand inside the frontend workspace.
  ts ??= require("typescript");
  const inProject = filename.startsWith(sourceRoot);
  const editorInputs = inProject ? currentEditorInputs() : undefined;
  if (!project && inProject && ts.sys.readFile(filename) === text) {
    // The in-process checker avoids spawning a compiler from the plugin.
    config = lintConfig(editorInputs);
    project = createProgram(config.roots, { snapshot: editorInputs });
  }
  config ??= lintConfig(editorInputs);
  const source = project?.getSourceFile(filename);
  if (source?.text === text)
    return findIdentifiers(source, project.getTypeChecker(), operands);

  // Preserve project-wide module augmentations for editor buffers. A
  // standalone test fixture needs only its own dependency graph.
  const roots = inProject ? config.roots : config.declarations;
  const buffer = createProgram([...new Set([filename, ...roots])], {
    filename,
    text,
    oldProgram: inProject ? project : undefined,
    snapshot: editorInputs,
  });
  if (inProject) project = buffer;
  return findIdentifiers(
    buffer.getSourceFile(filename),
    buffer.getTypeChecker(),
    operands,
  );
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
