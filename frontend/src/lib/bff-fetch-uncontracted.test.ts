// Every caller of bffJsonUncontracted, with the reason its BFF path has no
// Go contract (#7806). A path that gets a contract moves to bffJson and
// leaves this list; a new entry needs a named route.ts the contract cannot
// carry (docs/agents/new-route.md#when-a-route-needs-its-own-routets).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const UNCONTRACTED_CALLERS: Readonly<Record<string, string>> = {
  "lib/invitation-api.ts":
    "POST invitations/accept: a new account accepts without a session, an existing one with the owner's; the route's contract names only the tenant portal",
  "lib/enrollment-submission-api.ts":
    "GET enrollment/form-bootstrap/public/[tenantSlug]/[phaseId]: the route adds the signed-in staff member's profile to the public form",
  "lib/demo-access.ts":
    "POST demo/access/status, sessions, reset: the demo routes exist only with APP_ENV=demo and carry the token in the body or the BFF's cookie, so they have no Go contract",
  "lib/push-api.ts":
    "DELETE …/push/subscriptions during logout: the family is revoked and the sign-out must stay the last cookie change, so the call goes through the portal without a session (no gate, renewal or login redirect)",
  "lib/operator/provisioning-api.ts":
    "POST operator/provisioning/revalidate-tenant: the route purges the cached tenant lookup and the ISR pages, no backend route",
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
