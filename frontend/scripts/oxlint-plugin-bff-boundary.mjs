import { posix } from "node:path";
import { numericIdentifiers } from "./identifier-provenance.mjs";

// Infrastructure that cannot use its own transport. Remove entries as callers migrate.
const RAW_TRANSPORT = {
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
const UNCONTRACTED = {
  "lib/invitation-api.ts":
    "POST invitations/accept: a new account accepts without a session, an existing one with the owner's; the route's contract names only the tenant portal",
  "lib/enrollment-submission-api.ts":
    "GET enrollment/form-bootstrap/public/[tenantSlug]/[phaseId]: the route adds the signed-in staff member's profile to the public form",
  "components/tenant/tenant-relogin.ts":
    "POST auth/logout: the BFF revokes the session family before Auth.js drops the cookie",
  "lib/mfa-api.ts":
    "POST <portal>/auth/login, mfa/verify, mfa/enroll/confirm: sign-in steps whose route installs the session; mfa/resend, mfa/enroll/start: steps before the session whose route forwards the challenge or enrollment proof (authStepProxy), and the backend answers them without the envelope (plain)",
  "lib/operator/operator-invitation-api.ts":
    "POST operator/auth/invitations/session, validate, accept: the route keeps the token in the flow's cookie",
  "lib/passkey-api.ts":
    "POST <portal>/auth/passkeys/login/verify: a sign-in step whose route installs the session; passkeys/login/options: a step before the session (authStepProxy) whose backend answer has no envelope (plain)",
  "lib/demo-access.ts":
    "POST demo/access/status, sessions, reset: the demo routes exist only with APP_ENV=demo and carry the token in the body or the BFF's cookie, so they have no Go contract",
  "lib/portal-password-login.ts":
    "POST caterer/auth/login, parent/auth/login: sign-in steps whose route installs the session",
  "lib/shell-auth-context.tsx":
    "POST <portal>/auth/logout: the BFF revokes the session family before Auth.js drops the cookie",
  "lib/email-code-factor-api.ts":
    "POST caterer/account/mfa/confirm, parent/me/mfa/confirm: the route installs the renewed session",
  "lib/staff-preview-api.ts":
    "POST auth/staff-preview, auth/staff-preview/end: session steps of the BFF; the end reads the preview token from the cookie",
  "lib/tenant-api.ts":
    "POST auth/switch-tenant: the session switch of the BFF (ADR 0270, sign-in steps)",
  "lib/traeger-api.ts":
    "POST traeger/auth/login, traeger/auth/mfa/step-up/verify: sign-in and session steps of the BFF, no backend route of their own",
  "lib/push-api.ts":
    "DELETE …/push/subscriptions during logout: the family is revoked and the sign-out must stay the last cookie change, so the call goes through the portal without a session (no gate, renewal or login redirect)",
  "lib/operator/provisioning-api.ts":
    "POST operator/provisioning/revalidate-tenant: the route purges the cached tenant lookup and the ISR pages, no backend route",
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
const NAVIGATOR = "navigator";
const RAW_GLOBALS = new Set(["fetch", "XMLHttpRequest"]);
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
      !/\b(?:fetch|XMLHttpRequest|sendBeacon|sessionFetch|transportFetch|authFetch|fetchWithAuth|traegerRequest|operatorFetch)\b|\\/.test(
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
        if (object === "global") return childOwner(key);
        if (object === "document" && key === "defaultView") return "global";
      }
      if (node.type !== "Identifier") return;
      const global = childOwner(node.name);
      if (global && isGlobal(sourceCode, node)) return global;
      for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get(node.name);
        if (!variable) continue;
        const binding = variable.defs[0]?.node;
        if (
          binding?.type === "VariableDeclarator" &&
          binding.init &&
          binding.range[1] <= node.range[0] &&
          !variable.references.some((ref) => ref.isWrite() && !ref.init)
        ) {
          return bindingOwner(
            binding.id,
            owner(binding.init),
            variable.identifiers[0],
          );
        }
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
      if (GLOBAL_OBJECTS.has(key)) return "global";
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
      unused: "Remove this file's unused bffJsonUncontracted exception.",
    },
  },
  create(context) {
    const file = sourcePath(context);
    if (!file || isTest(file) || file === "lib/bff-fetch.ts") return {};
    const allowed = Object.hasOwn(UNCONTRACTED, file);
    if (!allowed && !/bff-fetch|\\/.test(context.sourceCode.text)) return {};
    let used = false;
    const report = (node) => context.report({ node, messageId: "helper" });

    function isBffModule(node) {
      const path = node && staticName(node, true);
      if (typeof path !== "string") return false;
      const target = path.startsWith(".")
        ? posix.join(posix.dirname(file), path)
        : path.replace(/^[@~]\//, "");
      return target.replace(/\.[jt]sx?$/, "") === "lib/bff-fetch";
    }

    return {
      ImportDeclaration(node) {
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
              if (
                identifier.parent.type !== "CallExpression" ||
                identifier.parent.callee !== identifier
              )
                report(identifier);
              else used = true;
            }
          }
        }
      },
      ExportNamedDeclaration(node) {
        if (!isBffModule(node.source)) return;
        for (const specifier of node.specifiers) {
          if (staticName(specifier.local, false) === UNCONTRACTED_HELPER)
            report(specifier);
        }
      },
      ExportAllDeclaration(node) {
        if (isBffModule(node.source)) report(node);
      },
      ImportExpression(node) {
        if (isBffModule(node.source)) report(node);
      },
      CallExpression(node) {
        if (
          node.callee.name === "require" &&
          isBffModule(node.arguments[0]) &&
          isGlobal(context.sourceCode, node.callee)
        )
          report(node);
      },
      TSExternalModuleReference(node) {
        if (isBffModule(node.expression)) report(node);
      },
      "Program:exit"(node) {
        if (allowed && !used) context.report({ node, messageId: "unused" });
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
    if (!isBrowser(sourcePath(context))) return {};
    const { sourceCode } = context;
    const operands = new Map();

    function add(node) {
      if (node && node.type !== "Literal" && node.type !== "SpreadElement") {
        operands.set(node.range[0], node);
      }
    }

    function isConverter(callee) {
      if (callee?.type === "Identifier") {
        return COERCIONS.has(callee.name) && isGlobal(sourceCode, callee);
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
