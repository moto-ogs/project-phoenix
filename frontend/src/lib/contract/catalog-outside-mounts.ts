/**
 * Backend paths the root mounts outside a portal's mount (#2352). A portal's
 * catalog proxy reaches each of them under its own BFF prefix:
 * `/api/school/analytics-policy` → `/analytics-policy`, and in the staff
 * portal `/api/analytics-consent` → `/analytics-consent/`. The list is fixed
 * on purpose: a route the contract registers outside the mount stays
 * unreachable until it is named here.
 *
 * An entry is a head: it admits the paths that start with it. A `{name}`
 * segment stands for any one segment, and an entry that ends in `/` admits
 * only that path itself. The staff portal's account routes live below
 * `/auth` beside `/api`; each prefix or path is named on its own, never
 * `/auth`, `/auth/mfa` or `/auth/passkeys` as a whole, so no sign-in route
 * becomes reachable through the proxy (`catalog-outside-mounts.test.ts`).
 */
export const CATALOG_OUTSIDE_MOUNTS = {
  tenant: [
    "/analytics-consent",
    "/auth/invitations",
    "/auth/roles",
    "/auth/permissions",
    "/auth/accounts",
    "/auth/mfa/trusted-devices",
    "/auth/passkeys/",
    "/auth/passkeys/{passkeyId}/",
    "/auth/passkeys/enrollment/challenge",
    "/auth/passkeys/register/options",
    "/auth/passkeys/register/verify",
    "/auth/account/tenants",
    "/auth/link-to-tenant",
    "/auth/register",
    "/auth/staff-preview/candidates",
    "/auth/password/",
  ],
  parent: [
    "/analytics-consent",
    "/analytics-policy",
    "/parent-news-attachments",
  ],
  school: ["/analytics-consent", "/analytics-policy"],
  org: [],
  caterer: [],
  platform: [],
} as const satisfies Record<string, readonly string[]>;

/**
 * The same for the routes without a session (`portalRoutes.public`): the
 * one-time link of a care contract mail lives at
 * `/public/care-contract-signing`, and the staff portal's proxy serves it as
 * `/api/public/care-contract-signing/…`, the path the link's page calls. The
 * staff portal's password reset lives at `/auth/password-reset` beside
 * `/api`; its hand-off file below `/api/auth` reaches it.
 *
 * The link's page lives under `/parents/…` on the parents host, yet the staff
 * portal's proxy (`app/api/[...path]`) serves it on purpose: its public path
 * reads no session and sends no bearer, so which portal's proxy answers does
 * not matter, and `/api/public/` is already open on the parents host
 * (`HOST_RULES.parent` in `src/proxy.ts`). The parent portal's proxy would
 * have to name the head as well, for no gain.
 */
export const CATALOG_PUBLIC_OUTSIDE_MOUNTS = {
  tenant: ["/public/care-contract-signing", "/auth/password-reset"],
} as const satisfies Record<string, readonly string[]>;

const isParam = (segment: string) =>
  segment.startsWith("{") && segment.endsWith("}");

/** A parameter never stands for an empty or a dot segment. */
const UNSAFE_SEGMENTS = new Set(["", ".", ".."]);

/**
 * Whether a path's segments, or a route pattern's, lie under an entry of the
 * lists above.
 */
export function underOutsideHead(
  path: readonly string[],
  head: string,
): boolean {
  const segments = head.split("/").filter(Boolean);
  if (head.endsWith("/") && path.length !== segments.length) return false;
  return segments.every((segment, index) => {
    const at = path[index];
    if (at === undefined) return false;
    return isParam(segment) ? !UNSAFE_SEGMENTS.has(at) : at === segment;
  });
}
