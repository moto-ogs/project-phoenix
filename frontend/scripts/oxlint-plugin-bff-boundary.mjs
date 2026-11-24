import { posix } from "node:path";
import { numericIdentifiers } from "./identifier-provenance.mjs";

// Infrastructure that cannot use its own transport. Remove entries as callers migrate.
export const RAW_TRANSPORT = {
  "lib/bff-fetch.ts": "the one transport of bffJson and bffFile",
  "lib/auth-failure.ts":
    "the session renewal of bffJson itself (POST /api/auth/token); going through bffJson would renew recursively",
  "lib/logger.ts":
    "log shipping: a failure must not raise an ApiError or reach the error observer it reports to",
  "lib/fetch-event-source.ts":
    "the SSE stream: an open event stream, not a JSON answer (docs/agents/realtime.md)",
  "lib/tenant-session-cookie.ts":
    "Auth.js endpoints (csrf, signout) with Auth.js's own answers, no BFF envelope",
  "components/tenant/tenant-guard.tsx":
    "Auth.js session endpoint (/api/auth/session) with Auth.js's own answer, no BFF envelope",
  "lib/display-api.ts":
    "the wall display: a device token in a header, no session, and an answer without the envelope (`plain`); no portal of bffJson fits",
  "components/search/school-search-help.ts":
    "a static file (the help search index), no BFF route",
  "lib/session-tenant-mismatch-observer.ts":
    "wraps the global fetch once: names this tab's account on every own BFF call, passes the session-end barrier and reports a foreign-session refusal (docs/agents/contracts.md)",
  "lib/rate-limit-backoff.ts":
    "wraps the global fetch once: holds BFF calls while a 429 wait runs and records the wait",
};

// Named route files whose browser-facing response is not the Go contract.
export const UNCONTRACTED = {
  // The Go contract covers only the tenant; new accounts may accept anonymously.
  "lib/invitation-api.ts": [
    "public POST tenant POST /auth/invitations/{token}/accept",
  ],
  // The named handler adds the signed-in staff profile (#5018).
  "lib/enrollment-submission-api.ts": [
    "public GET tenant GET /api/enrollment/form-bootstrap/public/{tenantSlug}/{phaseId}",
  ],
  // Demo routes project the backend result; the BFF status POST carries
  // the demo proof in its body, not in the browser URL or a session.
  "lib/demo-access.ts": [
    "public POST tenant POST /demo/access/reset",
    "public POST tenant GET /demo/access/status",
    "public POST tenant POST /demo/access/sessions",
  ],
};

const RETIRED_HELPERS = new Set([
  "sessionFetch",
  "transportFetch",
  "authFetch",
  "fetchWithAuth",
  "traegerRequest",
  "operatorFetch",
]);
const GLOBAL_OBJECTS = new Set(["window", "self", "globalThis"]);
const FRAME_WINDOWS = new Set(["top", "parent", "opener", "frames"]);
const NAVIGATOR = "navigator";
const RAW_GLOBALS = new Set([
  "fetch",
  "XMLHttpRequest",
  "EventSource",
  "WebSocket",
]);
const UNCONTRACTED_HELPER = "bffJsonUncontracted";

function sourcePath(context) {
  const file = context.physicalFilename.replaceAll("\\", "/");
  if (file.includes("/frontend/public/"))
    return "public/" + file.split("/frontend/public/").at(-1);
  const src = file.lastIndexOf("/src/");
  if (src >= 0) return file.slice(src + "/src/".length);
  if (file.startsWith("src/")) return file.slice("src/".length);
}

function isTest(file) {
  return (
    file.startsWith("test/") ||
    /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(file)
  );
}

function isBrowser(file) {
  return (
    file &&
    !isTest(file) &&
    !file.startsWith("app/api/") &&
    !file.startsWith("server/") &&
    !file.startsWith("lib/contract/") &&
    !/\.(?:server|d)\.[cm]?[jt]sx?$/.test(file)
  );
}

function staticName(node, computed) {
  if (!computed && node.type === "Identifier") return node.name;
  if (node.type === "Literal") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
}

function isGlobal(source, node) {
  return (
    node.type === "Identifier" &&
    (source.isGlobalReference(node) ||
      source.scopeManager.globalScope.through.some(
        (ref) => ref.identifier === node,
      ))
  );
}

const noRawBrowserTransport = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      transport:
        "Use bffJson or bffFile from ~/lib/bff-fetch instead of raw browser transport.",
      retired:
        "Use bffJson or bffFile from ~/lib/bff-fetch instead of a retired fetch helper.",
      unused: "Remove this file's unused raw transport exception.",
    },
  },
  create(context) {
    const file = sourcePath(context);
    if (!isBrowser(file)) return {};
    const { sourceCode } = context;
    const allowed = Object.hasOwn(RAW_TRANSPORT, file);
    // Skip the AST listeners if no relevant token can occur. Escapes always
    // go through the AST, which decides what the names actually refer to.
    if (
      !allowed &&
      !/\b(?:fetch|XMLHttpRequest|EventSource|WebSocket|sendBeacon|sessionFetch|transportFetch|authFetch|fetchWithAuth|traegerRequest|operatorFetch)\b|\\/.test(
        sourceCode.text,
      )
    )
      return {};
    let used = false;
    const report = (node) => {
      used = true;
      if (!allowed) context.report({ node, messageId: "transport" });
    };

    // Resolve stable aliases of browser globals; ordinary objects with a
    // property called fetch are not browser transport.
    function owner(node) {
      if (
        [
          "TSAsExpression",
          "TSTypeAssertion",
          "TSSatisfiesExpression",
          "TSNonNullExpression",
          "ChainExpression",
        ].includes(node.type)
      ) {
        return owner(node.expression);
      }
      if (node.type === "MemberExpression") {
        const key = staticName(node.property, node.computed);
        const object = owner(node.object);
        if (object === "global") {
          if (node.computed && /^(?:0|[1-9]\d*)$/.test(String(key)))
            return "global";
          return childOwner(key);
        }
        if (object === "document" && key === "defaultView") return "global";
      }
      if (node.type !== "Identifier") return;
      const global = childOwner(node.name);
      if (global && isGlobal(sourceCode, node)) return global;
      for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get(node.name);
        if (!variable) continue;
        const binding = variable.defs[0]?.node;
        if (binding?.type !== "VariableDeclarator") return;
        const writes = variable.references.filter(
          (ref) => ref.isWrite() && !ref.init,
        );
        if (
          binding.init &&
          binding.range[1] <= node.range[0] &&
          !writes.length
        ) {
          return bindingOwner(
            binding.id,
            owner(binding.init),
            variable.identifiers[0],
          );
        }
        const assignment = writes[0]?.identifier.parent;
        if (
          !binding.init &&
          writes.length === 1 &&
          assignment?.type === "AssignmentExpression" &&
          assignment.left === writes[0].identifier &&
          ["=", "??=", "||="].includes(assignment.operator) &&
          assignment.range[1] <= node.range[0]
        )
          return owner(assignment.right);
        return;
      }
    }

    function bindingOwner(pattern, object, identifier) {
      if (pattern === identifier) return object;
      if (pattern.type !== "ObjectPattern" || object !== "global") return;
      for (const property of pattern.properties) {
        if (property.type !== "Property") continue;
        const key = staticName(property.key, property.computed);
        const found = bindingOwner(property.value, childOwner(key), identifier);
        if (found) return found;
      }
    }

    function childOwner(key) {
      if (GLOBAL_OBJECTS.has(key) || FRAME_WINDOWS.has(key)) return "global";
      if (key === NAVIGATOR || key === "document") return key;
    }

    function checkProperty(node, object, name) {
      if (
        (RAW_GLOBALS.has(name) && object === "global") ||
        (name === "sendBeacon" && object === NAVIGATOR)
      )
        report(node);
    }

    function checkPattern(pattern, object) {
      if (pattern.type !== "ObjectPattern" || !object) return;
      for (const property of pattern.properties) {
        if (property.type !== "Property") continue;
        const key = staticName(property.key, property.computed);
        checkProperty(property, object, key);
        if (object === "global") checkPattern(property.value, childOwner(key));
      }
    }

    return {
      Identifier(node) {
        if (RETIRED_HELPERS.has(node.name))
          context.report({ node, messageId: "retired" });
        if (
          RAW_GLOBALS.has(node.name) &&
          node.parent.type !== "TSTypeQuery" &&
          isGlobal(sourceCode, node)
        )
          report(node);
      },
      MemberExpression(node) {
        const key = staticName(node.property, node.computed);
        if (RAW_GLOBALS.has(key) || key === "sendBeacon")
          checkProperty(node, owner(node.object), key);
      },
      VariableDeclarator(node) {
        if (node.id.type === "ObjectPattern" && node.init)
          checkPattern(node.id, owner(node.init));
      },
      AssignmentExpression(node) {
        if (node.left.type === "ObjectPattern")
          checkPattern(node.left, owner(node.right));
      },
      "Program:exit"(node) {
        if (allowed && !used) context.report({ node, messageId: "unused" });
      },
    };
  },
};

const onlyListedUncontracted = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      helper:
        "Use bffJson with a contract. Only the listed callers may use bffJsonUncontracted, and they must not forward it.",
      unused: "Remove the unused bffJsonUncontracted exception: {{route}}.",
      session: "Only session-bff.ts may construct a session BFF route.",
    },
  },
  create(context) {
    const file = sourcePath(context);
    if (!file || isTest(file) || file === "lib/bff-fetch.ts") return {};
    const allowed = Object.hasOwn(UNCONTRACTED, file);
    const remaining = new Set(UNCONTRACTED[file]);
    const report = (node) => context.report({ node, messageId: "helper" });

    function routeAddress(node) {
      if (!node) return;
      if (node.type !== "CallExpression") return staticName(node, true);
      const callee = node.callee;
      if (callee.type !== "Identifier") return;
      for (
        let scope = context.sourceCode.getScope(callee);
        scope;
        scope = scope.upper
      ) {
        const variable = scope.set.get(callee.name);
        if (!variable) continue;
        const specifier = variable.defs[0]?.node;
        if (
          specifier?.type !== "ImportSpecifier" ||
          staticName(specifier.imported, false) !== "bffPath" ||
          !isBffModule(specifier.parent.source)
        )
          return;
        const [portal, key] = node.arguments;
        return `${portal && staticName(portal, true)} ${key && staticName(key, true)}`;
      }
    }

    function isModule(node, module) {
      const path = node && staticName(node, true);
      if (typeof path !== "string") return false;
      const target = path.startsWith(".")
        ? posix.join(posix.dirname(file), path)
        : path.replace(/^[@~]\//, "");
      return posix.normalize(target).replace(/\.[jt]sx?$/, "") === module;
    }
    const isBffModule = (node) => isModule(node, "lib/bff-fetch");
    function restrictedSessionModule(source, node) {
      if (
        file === "lib/session-bff.ts" ||
        !isModule(source, "lib/session-bff-route")
      )
        return false;
      if (node.importKind === "type" || node.exportKind === "type")
        return false;
      if (
        node.specifiers?.length &&
        node.specifiers.every(
          (specifier) =>
            specifier.importKind === "type" || specifier.exportKind === "type",
        )
      )
        return false;
      context.report({ node, messageId: "session" });
      return true;
    }

    return {
      ImportDeclaration(node) {
        if (restrictedSessionModule(node.source, node)) return;
        if (!isBffModule(node.source)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") report(specifier);
          if (
            specifier.type !== "ImportSpecifier" ||
            staticName(specifier.imported, false) !== UNCONTRACTED_HELPER
          )
            continue;
          if (!allowed) {
            report(specifier);
            continue;
          }
          for (const variable of context.sourceCode.getDeclaredVariables(
            specifier,
          )) {
            for (const { identifier } of variable.references) {
              const call = identifier.parent;
              if (
                call.type !== "CallExpression" ||
                call.callee !== identifier
              ) {
                report(identifier);
                continue;
              }
              const [portal, method, address] = call.arguments;
              const route = `${portal && staticName(portal, true)} ${method && staticName(method, true)} ${routeAddress(address)}`;
              if (!remaining.delete(route)) report(identifier);
            }
          }
        }
      },
      ExportNamedDeclaration(node) {
        if (restrictedSessionModule(node.source, node)) return;
        if (!isBffModule(node.source)) return;
        for (const specifier of node.specifiers) {
          if (staticName(specifier.local, false) === UNCONTRACTED_HELPER)
            report(specifier);
        }
      },
      ExportAllDeclaration(node) {
        if (restrictedSessionModule(node.source, node)) return;
        if (isBffModule(node.source)) report(node);
      },
      ImportExpression(node) {
        if (restrictedSessionModule(node.source, node)) return;
        if (isBffModule(node.source)) report(node);
      },
      CallExpression(node) {
        if (
          node.callee.name === "require" &&
          isGlobal(context.sourceCode, node.callee)
        ) {
          if (restrictedSessionModule(node.arguments[0], node)) return;
          if (isBffModule(node.arguments[0])) report(node);
        }
      },
      TSExternalModuleReference(node) {
        if (restrictedSessionModule(node.expression, node)) return;
        if (isBffModule(node.expression)) report(node);
      },
      "Program:exit"(node) {
        for (const route of remaining)
          context.report({ node, messageId: "unused", data: { route } });
      },
    };
  },
};

const COERCIONS = new Set(["Number", "parseInt", "parseFloat", "BigInt"]);
const NUMBER_METHODS = new Set(["parseInt", "parseFloat"]);
const NUMERIC_OPERATORS = new Set([
  "-",
  "*",
  "/",
  "%",
  "**",
  "<<",
  ">>",
  ">>>",
  "&",
  "|",
  "^",
]);

const noNumericIdentifier = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      number:
        "Identifiers stay text. Do not convert them to numbers or use them in arithmetic.",
    },
  },
  create(context) {
    const file = sourcePath(context);
    if (!file || isTest(file) || /\.(?:generated|d)\.[cm]?[jt]s$/.test(file))
      return {};
    const { sourceCode } = context;
    const operands = new Map();

    function add(node) {
      if (node && node.type !== "Literal" && node.type !== "SpreadElement") {
        operands.set(node.range[0], node);
      }
    }

    function isConverter(callee, seen = new Set()) {
      if (!callee || seen.has(callee)) return false;
      seen.add(callee);
      if (
        [
          "TSAsExpression",
          "TSTypeAssertion",
          "TSNonNullExpression",
          "ChainExpression",
        ].includes(callee.type)
      ) {
        return isConverter(callee.expression, seen);
      }
      if (callee.type === "Identifier") {
        if (COERCIONS.has(callee.name) && isGlobal(sourceCode, callee))
          return true;
        for (
          let scope = sourceCode.getScope(callee);
          scope;
          scope = scope.upper
        ) {
          const variable = scope.set.get(callee.name);
          if (!variable) continue;
          const binding = variable.defs[0]?.node;
          if (
            binding?.type !== "VariableDeclarator" ||
            !binding.init ||
            variable.references.some((ref) => ref.isWrite() && !ref.init)
          )
            return false;
          if (binding.id.type === "Identifier")
            return isConverter(binding.init, seen);
          if (
            binding.id.type === "ObjectPattern" &&
            isGlobal(sourceCode, binding.init)
          ) {
            const property = binding.id.properties.find(
              (part) =>
                part.type === "Property" &&
                part.value === variable.identifiers[0],
            );
            const key = property && staticName(property.key, property.computed);
            return (
              (GLOBAL_OBJECTS.has(binding.init.name) && COERCIONS.has(key)) ||
              (binding.init.name === "Number" && NUMBER_METHODS.has(key))
            );
          }
          return false;
        }
        return false;
      }
      if (callee?.type !== "MemberExpression") return false;
      const { object } = callee;
      const name = staticName(callee.property, callee.computed);
      return (
        ((object.name === "Number" && NUMBER_METHODS.has(name)) ||
          (GLOBAL_OBJECTS.has(object.name) && COERCIONS.has(name))) &&
        isGlobal(sourceCode, object)
      );
    }

    function checkCall(node) {
      const { callee } = node;
      if (isConverter(callee)) {
        add(node.arguments[0]);
      } else if (callee.type === "MemberExpression") {
        const name = staticName(callee.property, callee.computed);
        if (
          (name === "map" || name === "flatMap") &&
          isConverter(node.arguments[0])
        ) {
          add(callee.object);
        }
        if (
          name === "from" &&
          callee.object.name === "Array" &&
          isGlobal(sourceCode, callee.object) &&
          isConverter(node.arguments[1])
        ) {
          add(node.arguments[0]);
        }
      }
    }

    return {
      CallExpression: checkCall,
      NewExpression: checkCall,
      UnaryExpression(node) {
        if (["+", "-", "~"].includes(node.operator)) add(node.argument);
      },
      UpdateExpression(node) {
        add(node.argument);
      },
      BinaryExpression(node) {
        if (NUMERIC_OPERATORS.has(node.operator)) {
          add(node.left);
          add(node.right);
        }
      },
      AssignmentExpression(node) {
        if (NUMERIC_OPERATORS.has(node.operator.slice(0, -1))) {
          add(node.left);
          add(node.right);
        }
      },
      "Program:exit"() {
        if (operands.size === 0) return;
        for (const node of numericIdentifiers(
          context.physicalFilename,
          sourceCode.text,
          operands,
        ) ?? []) {
          context.report({ node, messageId: "number" });
        }
      },
    };
  },
};

export default {
  meta: { name: "bff-boundary" },
  rules: {
    "no-raw-browser-transport": noRawBrowserTransport,
    "no-numeric-identifier": noNumericIdentifier,
    "only-listed-uncontracted": onlyListedUncontracted,
  },
};
