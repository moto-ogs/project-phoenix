import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { portalRoutes } from "~/lib/contract/portals.generated";

/**
 * A route that forwards a password or a code may not repeat a backend 401
 * with the renewed session (credential-retry.test.ts runs the known ones).
 * This finds them by their source: every route that names a credential
 * field or forwards to a credential step, and that imports a sender which
 * renews (a module reaching `portal-handlers.server`), must declare
 * `retry: { off: "<reason>" }`, or carry a reasoned entry in RETRY_KEPT.
 */

const SRC = path.join(process.cwd(), "src");
const API = path.join(SRC, "app/api");

const CREDENTIAL =
  /current_?[Pp]assword|\b[Pp]assword\b|\bpin\??:|\/(?:password|email-change|mfa\/(?:confirm|disable|verify)|mfa\/enroll\/confirm|passkeys\/(?:login|register)\/verify)\b/;

const RENEWING_ROOT = path.join(SRC, "lib/portal-handlers.server.ts");

/** Credential routes whose retry is wanted, by route directory. */
const RETRY_KEPT: Record<string, string> = {
  "auth/passkeys/register/verify":
    "a WebAuthn attestation of a one-time challenge, no password or code the account lock counts",
  "caterer/auth/passkeys/register/verify":
    "a WebAuthn attestation of a one-time challenge, no password or code the account lock counts",
  "operator/auth/passkeys/register/verify":
    "a WebAuthn attestation of a one-time challenge, no password or code the account lock counts",
  "auth/password-reset/[[...path]]":
    "a public route (#2352): the catalog proxy reads no session for it, so no renewal can repeat it",
  "caterer/auth/password-reset/[[...path]]":
    "a public route (#2352): the catalog proxy reads no session for it, so no renewal can repeat it",
  "parent/auth/password-reset/[[...path]]":
    "a public route (#2352): the catalog proxy reads no session for it, so no renewal can repeat it",
  "school/auth/password-reset/[[...path]]":
    "a public route (#2352): the catalog proxy reads no session for it, so no renewal can repeat it",
  "traeger/auth/password-reset/[[...path]]":
    "a public route (#2352): the catalog proxy reads no session for it, so no renewal can repeat it",
};

function filesUnder(dir: string, match: (file: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return filesUnder(file, match);
    return match(file) ? [file] : [];
  });
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function imports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/from\s+"([^"]+)"/g)].flatMap(([, spec]) => {
    if (!spec || !/^(?:\.|~\/)/.test(spec)) return [];
    const base = spec.startsWith("~/")
      ? path.join(SRC, spec.slice(2))
      : path.resolve(path.dirname(file), spec);
    const resolved = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]
      .filter((candidate) => existsSync(candidate))
      .at(0);
    return resolved ? [resolved] : [];
  });
}

/** Modules under src/lib that reach the renewing handlers. */
function renewingModules(): Set<string> {
  const modules = filesUnder(
    path.join(SRC, "lib"),
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
  const edges = new Map(modules.map((file) => [file, imports(file)]));
  const renewing = new Set([RENEWING_ROOT]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [file, targets] of edges) {
      if (!renewing.has(file) && targets.some((t) => renewing.has(t))) {
        renewing.add(file);
        grew = true;
      }
    }
  }
  return renewing;
}

const routes = filesUnder(API, (file) => path.basename(file) === "route.ts");
const renewing = renewingModules();
const credentialRoutes = routes
  .filter((file) =>
    CREDENTIAL.test(withoutComments(readFileSync(file, "utf8"))),
  )
  .filter((file) => imports(file).some((target) => renewing.has(target)))
  .map((file) => path.relative(API, path.dirname(file)));

describe("routes that forward a password or a code", () => {
  it("finds the routes credential-retry.test.ts runs", () => {
    expect(credentialRoutes).toEqual(
      expect.arrayContaining([
        "auth/password",
        "operator/profile/password",
        "caterer/account/password",
        "caterer/account/mfa/disable",
        "caterer/account/mfa/confirm",
        "parent/me/mfa/disable",
        "parent/me/mfa/confirm",
      ]),
    );
  });

  it.each(credentialRoutes)("%s turns the retry off", (route) => {
    if (route in RETRY_KEPT) return;
    const source = readFileSync(path.join(API, route, "route.ts"), "utf8");
    expect(source).toMatch(/retry:\s*\{\s*off:\s*"[^"]+"/);
  });

  it("keeps no stale RETRY_KEPT entry", () => {
    expect(
      Object.keys(RETRY_KEPT).filter(
        (route) => !credentialRoutes.includes(route),
      ),
    ).toEqual([]);
  });
});

describe("catalog routes that forward a password or a code", () => {
  // The catalog proxy reads the trait from the contract (#2352);
  // credential-retry.test.ts runs both routes through their catch-all.
  it.each([
    ["parent", "POST /parent/me/news/{announcementId}/declaration"],
    ["org", "POST /traeger/auth/mfa/step-up"],
    ["platform", "POST /operator/profile/email-change"],
    // Served by their temporary route files until the next production
    // deploy, then by the catalog proxy.
    ["tenant", "POST /auth/password"],
    ["platform", "POST /operator/profile/password"],
    ["caterer", "POST /caterer/account/password"],
    ["caterer", "POST /caterer/account/mfa/disable"],
    ["parent", "POST /parent/me/mfa/disable"],
  ] as const)("%s %s turns the retry off", (portal, key) => {
    const route = portalRoutes[portal].find(
      (entry) => `${entry.method} ${entry.pattern}` === key,
    );
    expect(route).toBeDefined();
    expect(route).toHaveProperty("noRetryAfterRenewal", expect.any(String));
  });
});
