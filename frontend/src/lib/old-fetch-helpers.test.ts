// The browser reaches the BFF one way: bffJson for JSON, bffFile for files
// (lib/bff-fetch.ts, #7806). This guard keeps it that way:
// - the old helpers are gone, and none of their names comes back, neither as
//   an import nor as a definition of its own;
// - browser code calls `fetch` itself only in the infrastructure listed
//   below, each file with the reason bffJson cannot carry it.
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
};

/**
 * Files of the #7806 slices that have not merged yet. Empty when the final
 * wave lands; a file leaves the list in the change that moves it.
 */
const PENDING: Readonly<Record<string, string>> = {
  "lib/message-attachments.ts": "c3 #7880",
  "lib/notification-api.ts": "c3 #7880",
  "lib/notification-preferences-api.ts": "c3 #7880",
  "lib/parent-announcements-api.ts": "c3 #7880",
  "lib/parent-group-threads-api.ts": "c3 #7880",
  "lib/parent-messages-api.ts": "c3 #7880",
  "lib/push-api.ts": "c3 #7880",
  "lib/staff-messages-api.ts": "c3 #7880",
  "lib/staff-notices-api.ts": "c3 #7880",
  "lib/surveys-api.ts": "c3 #7880",
  "lib/demo-access.ts": "c4 #7887",
  "lib/mfa-api.ts": "c4 #7887",
  "lib/passkey-api.ts": "c4 #7887",
  "lib/enrollment-http.ts": "enrollment transport after c6/c7",
  "lib/parent-api.ts": "enrollment transport after c6/c7",
  "lib/api-error.ts": "transportFetch definition, removed when the slices land",
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
const RAW_FETCH_CALL = /(?<![\w.$])fetch\(/;

describe("one way from the browser to the BFF", () => {
  it("names none of the old fetch helpers", () => {
    const named = FILES.filter(({ text }) => OLD_NAME.test(text))
      .map(({ path }) => path)
      .filter((path) => !(path in PENDING))
      .sort();

    expect(named).toEqual([]);
  });

  it("calls fetch itself only in the listed infrastructure", () => {
    const callers = FILES.filter(({ text }) => RAW_FETCH_CALL.test(text))
      .map(({ path }) => path)
      .filter((path) => !(path in PENDING))
      .sort();

    expect(callers).toEqual(Object.keys(RAW_FETCH).sort());
  });

  it("keeps no pending file that already moved", () => {
    const stale = Object.keys(PENDING).filter((path) => {
      const file = FILES.find((candidate) => candidate.path === path);
      return (
        !file || (!OLD_NAME.test(file.text) && !RAW_FETCH_CALL.test(file.text))
      );
    });

    expect(stale).toEqual([]);
  });
});
