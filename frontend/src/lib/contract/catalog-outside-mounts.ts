/**
 * Backend paths the root mounts outside a portal's mount (#2352). A portal's
 * catalog proxy reaches each of them under its own BFF prefix:
 * `/api/school/analytics-policy` → `/analytics-policy`, and in the staff
 * portal `/api/analytics-consent` → `/analytics-consent/`. The list is fixed
 * on purpose: a route the contract registers outside the mount stays
 * unreachable until it is named here.
 */
export const CATALOG_OUTSIDE_MOUNTS = {
  tenant: ["/analytics-consent"],
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
