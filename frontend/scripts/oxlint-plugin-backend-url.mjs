// #7808: every server call to Go goes through sendBackend
// (src/lib/backend-client.server.ts), which adds bearer, client identity,
// timeout, log line and metric. Depcruise forbids importing the backend URL
// helper elsewhere; this rule closes the other way around it, reading
// API_URL from the environment directly. Only src/lib/server-api-url.ts reads
// it, and src/env.js declares it for the environment schema.
const READERS = new Set(["src/lib/server-api-url.ts", "src/env.js"]);
const NAME = "API_URL";

function fileKey(context) {
  const file = String(
    context.physicalFilename ?? context.filename ?? "",
  ).replaceAll("\\", "/");
  const index = file.lastIndexOf("/src/");
  return index === -1 ? file : file.slice(index + 1);
}

function binding(source, id) {
  for (let scope = source.getScope(id); scope; scope = scope.upper) {
    const variable = scope.set.get(id.name);
    if (variable) return variable.defs[0];
  }
}

function resolveBinding(node, source, seen) {
  const def = binding(source, node);
  if (
    def?.type !== "Variable" ||
    def.node.id.type !== "Identifier" ||
    seen.has(def.node)
  )
    return;
  seen.add(def.node);
  return def.node.init;
}

function staticString(node, source, seen = new Set()) {
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "Identifier")
    return staticString(resolveBinding(node, source, seen), source, seen);
  if (node?.type === "BinaryExpression" && node.operator === "+") {
    const left = staticString(node.left, source, new Set(seen));
    const right = staticString(node.right, source, new Set(seen));
    return left != null && right != null ? left + right : null;
  }
  if (node?.type === "TemplateLiteral") {
    const expressions = node.expressions.map((part) =>
      staticString(part, source, new Set(seen)),
    );
    if (expressions.includes(null)) return null;
    return node.quasis
      .map((part, index) => part.value.cooked + (expressions[index] ?? ""))
      .join("");
  }
  return null;
}

function propertyName(key, computed, source) {
  if (!computed && key.type === "Identifier") return key.name;
  return staticString(key, source);
}

function isProcess(node, source, seen = new Set()) {
  if (node?.type === "Identifier") {
    const def = binding(source, node);
    if (!def) return node.name === "process";
    return isProcess(resolveBinding(node, source, seen), source, seen);
  }
  return (
    node?.type === "MemberExpression" &&
    propertyName(node.property, node.computed, source) === "process" &&
    node.object.type === "Identifier" &&
    node.object.name === "globalThis" &&
    !binding(source, node.object)
  );
}

function destructuresProcessEnv(def, localName, source) {
  if (
    def?.type !== "Variable" ||
    def.node.id.type !== "ObjectPattern" ||
    !isProcess(def.node.init, source)
  )
    return false;
  return def.node.id.properties.some((property) => {
    if (property.type !== "Property") return false;
    const target =
      property.value.type === "AssignmentPattern"
        ? property.value.left
        : property.value;
    return (
      target.type === "Identifier" &&
      target.name === localName &&
      propertyName(property.key, property.computed, source) === "env"
    );
  });
}

// Follow the lexical binding, including aliased imports and const assignments.
function isEnvironment(node, source, seen = new Set()) {
  if (node?.type === "Identifier") {
    const def = binding(source, node);
    if (def?.type === "ImportBinding") {
      return (
        def.node.imported?.name === "env" &&
        /(?:^|\/)env(?:\.[cm]?[jt]s)?$/.test(def.parent.source.value)
      );
    }
    if (destructuresProcessEnv(def, node.name, source)) return true;
    return isEnvironment(resolveBinding(node, source, seen), source, seen);
  }
  return (
    node?.type === "MemberExpression" &&
    propertyName(node.property, node.computed, source) === "env" &&
    isProcess(node.object, source)
  );
}

function isWrite(node) {
  const parent = node.parent;
  return (
    (parent?.type === "AssignmentExpression" && parent.left === node) ||
    (parent?.type === "UnaryExpression" && parent.operator === "delete")
  );
}

const onlyServerApiUrl = {
  meta: {
    type: "problem",
    docs: {
      description: "Read the backend URL only in src/lib/server-api-url.ts.",
    },
    schema: [],
    messages: {
      read: "Call Go through sendBackend (~/lib/backend-client.server); only src/lib/server-api-url.ts reads API_URL.",
    },
  },
  create(context) {
    if (READERS.has(fileKey(context))) return {};
    const source = context.sourceCode;
    return {
      MemberExpression(node) {
        if (
          propertyName(node.property, node.computed, source) === NAME &&
          isEnvironment(node.object, source) &&
          !isWrite(node)
        ) {
          context.report({ node, messageId: "read" });
        }
      },
      VariableDeclarator(node) {
        if (
          node.id.type !== "ObjectPattern" ||
          !isEnvironment(node.init, source)
        )
          return;
        for (const property of node.id.properties) {
          const name =
            property.type === "Property"
              ? propertyName(property.key, property.computed, source)
              : null;
          if (name === NAME)
            context.report({ node: property, messageId: "read" });
        }
      },
    };
  },
};

export default {
  meta: { name: "backend-url" },
  rules: { "only-server-api-url": onlyServerApiUrl },
};
