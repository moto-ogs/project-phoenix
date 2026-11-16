// Deterministic test clock ratchet (issue #3101).
//
// `src/test/setup-common.ts` freezes `Date` before every test and restores
// the real clock afterwards. The freeze reaches every `new Date()` in the
// rendered component tree and in libraries, so a test cannot drift onto the
// CI host's date by accident. What the setup cannot prevent is a test that
// hands itself the real clock again; this rule catches those escapes:
//
//   test-clock/no-real-clock
//     - `vi.useRealTimers()` outside `afterEach` / `afterAll`. Inside a test
//       body or a `before*` hook it drops the frozen clock for the rest of
//       the test. Use `releaseFakeTimers()` from `~/test/clock` to give the
//       timers back to the event loop while the clock stays frozen, or
//       `useRealClock("reason")` for a reviewed real-time exception.
//     - `useRealClock()` without a non-empty string-literal reason.
//     - `vi.getRealSystemTime()`, `vi.stubGlobal("Date", …)`, direct global
//       `Date = …` assignments, assignments to `globalThis.Date` /
//       `global.Date` / `window.Date` (including computed `["Date"]`
//       properties), and reflective `Object` / `Reflect` writes to global
//       `Date`, which read or replace the real clock behind the setup's back.
//
//     - Playwright specs and helpers (`e2e/`) and stories (`*.stories.*`)
//       run outside that freeze (#7296): browser, Next server and backend
//       keep the host clock. There the rule rejects every read of it:
//       `new Date()`, `Date.now()` and, in `e2e/`, the app's today readers
//       (`berlinTodayISO()`, `todayISO()`). A spec takes its day from
//       `runToday()` in `e2e/clock.ts`, measures with `performance.now()`
//       and declares a wall-clock need as `realClock("reason")`; a story
//       takes the time from `storyNow()` in `.storybook/clock.ts`, which the
//       Storybook tests and the pixel comparison freeze.
//
// There is no baseline and no allowlist: an exception is `useRealClock` or
// `realClock` with its reason in the call, not a disable comment.

const AFTER_HOOKS = new Set(["afterEach", "afterAll"]);
const DATE_GLOBAL_OBJECTS = new Set(["globalThis", "global", "window", "self"]);
const CLOCK_HELPER_FILE = "src/test/clock.ts";
// The two files of the specs that may read the host clock: the run's day and
// the declared wall-clock exception.
const RUN_CLOCK_FILE = "e2e/clock.ts";
const REAL_CLOCK_FILE = "e2e/real-clock.mjs";
const TODAY_READERS = new Set(["berlinTodayISO", "todayISO"]);
const STORY_FILE = /\.stories\.[cm]?[jt]sx?$/;

/** Repo-relative posix path ("src/…", "e2e/…" or "scripts/…"), or "" when unavailable. */
function fileKey(context) {
  const raw = String(context.physicalFilename ?? context.filename ?? "");
  const posix = raw.replaceAll("\\", "/");
  for (const marker of ["/src/", "/e2e/", "/scripts/"]) {
    const idx = posix.lastIndexOf(marker);
    if (idx !== -1) return posix.slice(idx + 1);
  }
  return posix;
}

function isViMember(callee, name) {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "vi" &&
    callee.property.type === "Identifier" &&
    callee.property.name === name
  );
}

function isStaticMember(callee, objectName, propertyName) {
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === objectName &&
    ((callee.property.type === "Identifier" &&
      callee.property.name === propertyName) ||
      (isStringLiteral(callee.property) &&
        literalText(callee.property) === propertyName))
  );
}

function isInsideAfterHook(sourceCode, node) {
  for (const ancestor of sourceCode.getAncestors(node)) {
    if (
      ancestor.type === "CallExpression" &&
      ancestor.callee.type === "Identifier" &&
      AFTER_HOOKS.has(ancestor.callee.name)
    ) {
      return true;
    }
  }
  return false;
}

function isStringLiteral(node) {
  if (!node) return false;
  if (node.type === "Literal") return typeof node.value === "string";
  return node.type === "TemplateLiteral" && node.expressions.length === 0;
}

function literalText(node) {
  if (node.type === "Literal") return node.value;
  return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
}

function findVariable(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);

  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }

  return undefined;
}

function isDateProperty(node) {
  return (
    (node.type === "Identifier" && node.name === "Date") ||
    (isStringLiteral(node) && literalText(node) === "Date")
  );
}

function isGlobalDateIdentifier(node, sourceCode) {
  if (node.type !== "Identifier" || node.name !== "Date") return false;
  const variable = findVariable(sourceCode, node);
  return !variable || variable.defs.length === 0;
}

function isDateGlobalMember(node) {
  return (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    DATE_GLOBAL_OBJECTS.has(node.object.name) &&
    isDateProperty(node.property)
  );
}

function isGlobalDateObject(node) {
  return node?.type === "Identifier" && DATE_GLOBAL_OBJECTS.has(node.name);
}

function isGlobalDateWrite(callee, arguments_) {
  if (
    !isGlobalDateObject(arguments_[0]) ||
    !isStringLiteral(arguments_[1]) ||
    literalText(arguments_[1]) !== "Date"
  ) {
    return false;
  }

  return (
    isStaticMember(callee, "Object", "defineProperty") ||
    isStaticMember(callee, "Reflect", "defineProperty") ||
    isStaticMember(callee, "Reflect", "set")
  );
}

function isGlobalDateNow(callee, sourceCode) {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    isGlobalDateIdentifier(callee.object, sourceCode) &&
    callee.property.type === "Identifier" &&
    callee.property.name === "now"
  );
}

/** Where the Vitest freeze does not reach: "spec", "story" or null. */
function hostClockSurface(file) {
  if (file === REAL_CLOCK_FILE) return null;
  if (file.startsWith("e2e/")) return "spec";
  return STORY_FILE.test(file) ? "story" : null;
}

const noRealClock = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep frontend tests on the deterministic test clock installed by src/test/setup-common.ts.",
    },
    messages: {
      realTimersInTest:
        'vi.useRealTimers() outside afterEach/afterAll drops the frozen test clock. Use releaseFakeTimers() from ~/test/clock to hand the timers back while the clock stays frozen, or useRealClock("reason") for a reviewed real-time exception.',
      missingReason:
        'useRealClock() needs its reviewed reason as a non-empty string literal, e.g. useRealClock("measures real elapsed time").',
      realSystemTime:
        'vi.getRealSystemTime() reads the host clock. Assert against the frozen test clock (TEST_CLOCK_INSTANT / setTestClock) or declare useRealClock("reason").',
      dateReplaced:
        "Replacing the global Date bypasses the deterministic test clock. Use setTestClock() / vi.setSystemTime() to move time, or vi.useFakeTimers() to control it.",
      specClockRead:
        'A Playwright spec reads the host clock here. Take the day from runToday() in e2e/clock.ts, measure durations with performance.now(), and declare a wall-clock need as realClock("reason").',
      storyClockRead:
        "A story reads the host clock here. Take the time from storyNow() in .storybook/clock.ts, which the Storybook tests and the pixel comparison freeze, and measure durations with performance.now().",
      missingRealClockReason:
        'realClock() needs its reviewed reason as a non-empty string literal, e.g. realClock("Mailpit stamps mails with the wall clock").',
    },
    schema: [],
  },
  create(context) {
    const file = fileKey(context);
    if (file === CLOCK_HELPER_FILE) return {};
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const surface = hostClockSurface(file);
    const clockRead = surface === "story" ? "storyClockRead" : "specClockRead";

    return {
      NewExpression(node) {
        if (
          surface &&
          node.arguments.length === 0 &&
          isGlobalDateIdentifier(node.callee, sourceCode)
        ) {
          context.report({ node, messageId: clockRead });
        }
      },
      CallExpression(node) {
        const { callee } = node;

        if (surface && isGlobalDateNow(callee, sourceCode)) {
          context.report({ node, messageId: clockRead });
          return;
        }

        if (surface === "spec" && callee.type === "Identifier") {
          if (
            file !== RUN_CLOCK_FILE &&
            TODAY_READERS.has(callee.name) &&
            node.arguments.length === 0
          ) {
            context.report({ node, messageId: "specClockRead" });
            return;
          }
          if (callee.name === "realClock") {
            const reason = node.arguments[0];
            if (!isStringLiteral(reason) || literalText(reason).trim() === "") {
              context.report({ node, messageId: "missingRealClockReason" });
            }
            return;
          }
        }

        if (isViMember(callee, "useRealTimers")) {
          if (!isInsideAfterHook(sourceCode, node)) {
            context.report({ node, messageId: "realTimersInTest" });
          }
          return;
        }

        if (isViMember(callee, "getRealSystemTime")) {
          context.report({ node, messageId: "realSystemTime" });
          return;
        }

        if (
          isViMember(callee, "stubGlobal") &&
          isStringLiteral(node.arguments[0]) &&
          literalText(node.arguments[0]) === "Date"
        ) {
          context.report({ node, messageId: "dateReplaced" });
          return;
        }

        if (isGlobalDateWrite(callee, node.arguments)) {
          context.report({ node, messageId: "dateReplaced" });
          return;
        }

        if (callee.type === "Identifier" && callee.name === "useRealClock") {
          const reason = node.arguments[0];
          if (!isStringLiteral(reason) || literalText(reason).trim() === "") {
            context.report({ node, messageId: "missingReason" });
          }
        }
      },
      AssignmentExpression(node) {
        if (
          isGlobalDateIdentifier(node.left, sourceCode) ||
          isDateGlobalMember(node.left)
        ) {
          context.report({ node, messageId: "dateReplaced" });
        }
      },
    };
  },
};

export default {
  meta: { name: "test-clock" },
  rules: { "no-real-clock": noRealClock },
};
