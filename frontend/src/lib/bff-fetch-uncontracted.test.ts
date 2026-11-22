// Every caller of bffJsonUncontracted, with the reason its BFF path has no
// Go contract (#7806). A path that gets a contract moves to bffJson and
// leaves this list; a new entry needs a named route.ts the contract cannot
// carry (docs/agents/new-route.md#when-a-route-needs-its-own-routets).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const UNCONTRACTED_CALLERS: Readonly<Record<string, string>> = {
  "lib/enrollment-submission-api.ts":
    "GET enrollment/form-bootstrap/public/[tenantSlug]/[phaseId]: the route adds the signed-in staff member's profile to the public form",
  "lib/email-code-factor-api.ts":
    "POST caterer/account/mfa/confirm, parent/me/mfa/confirm: the route installs the renewed session",
  "lib/payroll-api.ts":
    "PUT settings/values/[key]: the route purges the cached tenant lookup",
  "lib/staff-preview-api.ts":
    "POST auth/staff-preview: a session step of the BFF, no backend route of its own",
  "lib/tenant-api.ts":
    "POST auth/switch-tenant: the session switch of the BFF (ADR 0270, sign-in steps)",
  "lib/settings-api.ts":
    "PUT/DELETE settings/values/[key]: the route purges the cached tenant lookup",
  "lib/traeger-api.ts":
    "POST traeger/auth/mfa/step-up/verify: a session step of the BFF, no backend route of its own",
  "lib/traeger-holiday-form-api.ts":
    "PUT traeger/holiday-periods/[id]/form: the contract leaves the editor's own body undescribed",
  "lib/operator/operator-settings-api.ts":
    "PUT/DELETE operator/provisioning/schools/[id]/settings/values/[key]: the route purges the cached tenant lookup",
};

const SRC = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe("bffJsonUncontracted", () => {
  it("is called only by the listed files", () => {
    const callers = sourceFiles(SRC)
      .filter((file) =>
        /bffJsonUncontracted[<(]/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(SRC, file))
      .filter((file) => file !== "lib/bff-fetch.ts")
      .sort();

    expect(callers).toEqual(Object.keys(UNCONTRACTED_CALLERS).sort());
  });
});
