// The browser reaches the BFF one way: bffJson for JSON, bffFile for files
// (lib/bff-fetch.ts, #7806). This guard keeps it that way:
// - the old helpers are gone, and none of their names comes back, neither as
//   an import nor as a definition of its own;
// - browser code calls `fetch` itself (also as `window.fetch`,
//   `globalThis.fetch` or `self.fetch`) or replaces it only in the
//   infrastructure listed below, each file with the reason bffJson cannot
//   carry it.
// Server code (src/app/api, src/server, *.server.ts) talks to the backend
// through sendBackend and is not browser code.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const OLD_HELPERS = [
  "sessionFetch",
  "transportFetch",
  "authFetch",
  "fetchWithAuth",
  "traegerRequest",
  "operatorFetch",
];

/** Browser code that calls `fetch` itself, and why bffJson cannot. */
const RAW_FETCH: Readonly<Record<string, string>> = {
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

const SRC = join(import.meta.dirname, "..");

function isBrowserFile(path: string): boolean {
  return (
    !path.startsWith("app/api/") &&
    !path.startsWith("server/") &&
    !path.startsWith("test/") &&
    !/\.server\.tsx?$/.test(path) &&
    !/\.(test|stories)\.tsx?$/.test(path) &&
    !path.startsWith("lib/contract/")
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const FILES = sourceFiles(SRC)
  .map((file) => ({
    path: relative(SRC, file),
    text: readFileSync(file, "utf8"),
  }))
  .filter(({ path }) => isBrowserFile(path));

const OLD_NAME = new RegExp(String.raw`\b(?:${OLD_HELPERS.join("|")})\b`);
// A call of the global fetch, also through window/globalThis/self, and a
// replacement of it (`window.fetch = …`).
const RAW_FETCH_CALL =
  /(?<![\w.$])(?:(?:window|globalThis|self)\.)?fetch\(|(?<![\w.$])(?:window|globalThis|self)\.fetch\s*=(?!=)/;

describe("one way from the browser to the BFF", () => {
  it("names none of the old fetch helpers", () => {
    const named = FILES.filter(({ text }) => OLD_NAME.test(text))
      .map(({ path }) => path)
      .sort();

    expect(named).toEqual([]);
  });

  it("calls fetch itself only in the listed infrastructure", () => {
    const callers = FILES.filter(({ text }) => RAW_FETCH_CALL.test(text))
      .map(({ path }) => path)
      .sort();

    expect(callers).toEqual(Object.keys(RAW_FETCH).sort());
  });
});
