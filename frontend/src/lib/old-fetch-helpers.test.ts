// The browser calls a JSON route of the BFF through bffJson (#7806). The
// older helpers (sessionFetch for JSON, authFetch, fetchWithAuth,
// traegerRequest, operatorFetch) may be imported only by the files listed
// here, each with the reason it has not moved yet. The list only shrinks:
// a new importer fails, and so does an entry that no longer imports one, so
// a migrated file leaves the list in the same change. Once it is empty the
// helpers go away with it.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const OLD_HELPERS = [
  "sessionFetch",
  "authFetch",
  "fetchWithAuth",
  "traegerRequest",
  "operatorFetch",
];

// bff-fetch.ts sends the tenant portal through sessionFetch: that is the
// helper's own transport, not a JSON caller.
const TRANSPORT = new Set(["lib/bff-fetch.ts"]);

const REMAINING_IMPORTERS: Readonly<Record<string, string>> = {
  "lib/shift-api.ts":
    "sessionFetch: the shift writes have no request type in the contract (#7808)",
  "lib/guardian-payment-api.ts":
    "sessionFetch: the payment export has no request type in the contract (#7808)",
  "components/settings/personalization-tab.tsx":
    "sessionFetch: the login image route has no contract (#7808)",
  "lib/email-code-factor-api.ts":
    "authFetch: the second factor of caterer and parents; confirm installs a new session in its own route.ts (#7806)",
  "lib/caterer-api.ts": "authFetch: caterer portal, #7806 Teil B",
  "lib/staff-pool-api.ts": "traegerRequest: Träger portal, #7806 Teil B",
  "lib/traeger-holiday-form-api.ts":
    "traegerRequest: Träger portal, #7806 Teil B",
  "lib/operator/operator-settings-api.ts":
    "operatorFetch: operator portal, #7806 Teil B",
};

const SRC = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|stories)\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

const IMPORT = new RegExp(
  String.raw`import\s+(?:type\s+)?\{[^}]*\b(?:${OLD_HELPERS.join("|")})\b[^}]*\}\s+from`,
  "s",
);

describe("old fetch helpers", () => {
  it("are imported only by the listed files", () => {
    const importers = sourceFiles(SRC)
      .filter((file) => IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file))
      .filter((file) => !TRANSPORT.has(file))
      .sort();

    expect(importers).toEqual(Object.keys(REMAINING_IMPORTERS).sort());
  });
});
