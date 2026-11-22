// #7808: every server call to Go goes through sendBackend
// (src/lib/backend-client.server.ts), which adds bearer, client identity,
// timeout, log line and metric. Depcruise forbids importing the backend URL
// helper elsewhere; this rule closes the other way around it, reading
// API_URL from the environment directly. Only src/lib/server-api-url.ts reads
// it, and src/env.js declares it for the environment schema.
const READERS = new Set(["src/lib/server-api-url.ts", "src/env.js"]);
const NAME = "API_URL";

function fileKey(context) {
  const file = String(context.physicalFilename ?? context.filename ?? "").replaceAll("\\", "/");
  const index = file.lastIndexOf("/src/");
  return index === -1 ? file : file.slice(index + 1);
}

function propertyName(node) {
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.property.type === "Literal") return node.property.value;
  if (node.property.type === "TemplateLiteral" && node.property.expressions.length === 0) {
    return node.property.quasis[0]?.value.cooked;
  }
  return null;
}

// process.env, globalThis.process.env, or an imported env object (~/env).
function isEnvironment(node) {
  if (node.type === "Identifier") return node.name === "env";
  if (node.type !== "MemberExpression" || propertyName(node) !== "env") return false;
  const owner = node.object;
  if (owner.type === "Identifier") return owner.name === "process";
  return owner.type === "MemberExpression" && propertyName(owner) === "process";
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
    docs: { description: "Read the backend URL only in src/lib/server-api-url.ts." },
    schema: [],
    messages: {
      read: "Call Go through sendBackend (~/lib/backend-client.server); only src/lib/server-api-url.ts reads API_URL.",
    },
  },
  create(context) {
    if (READERS.has(fileKey(context))) return {};
    return {
      MemberExpression(node) {
        if (propertyName(node) === NAME && isEnvironment(node.object) && !isWrite(node)) {
          context.report({ node, messageId: "read" });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !node.init || !isEnvironment(node.init)) return;
        for (const property of node.id.properties) {
          const key = property.type === "Property" ? property.key : null;
          const name = key?.type === "Identifier" ? key.name : key?.type === "Literal" ? key.value : null;
          if (name === NAME) context.report({ node: property, messageId: "read" });
        }
      },
    };
  },
};

export default {
  meta: { name: "backend-url" },
  rules: { "only-server-api-url": onlyServerApiUrl },
};
