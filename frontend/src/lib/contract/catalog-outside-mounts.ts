/**
 * Backend paths the root mounts outside a portal's mount (#2352). A portal's
 * catalog proxy reaches each of them under its own BFF prefix:
 * `/api/school/analytics-policy` → `/analytics-policy`, and in the staff
 * portal `/api/analytics-consent` → `/analytics-consent/`. The list is fixed
 * on purpose: a route the contract registers outside the mount stays
 * unreachable until it is named here. The staff portal's invitation routes
 * live at `/auth/invitations` beside `/api`; only that prefix is named, not
 * `/auth`, so no sign-in route becomes reachable through the proxy.
 */
export const CATALOG_OUTSIDE_MOUNTS = {
  tenant: ["/analytics-consent", "/auth/invitations"],
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
 * `/api/public/care-contract-signing/…`, the path the link's page calls.
 */
export const CATALOG_PUBLIC_OUTSIDE_MOUNTS = {
  tenant: ["/public/care-contract-signing"],
} as const satisfies Record<string, readonly string[]>;
