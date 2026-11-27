/**
 * Utilities for parents subdomain URL handling.
 *
 * On the parents subdomain (e.g. eltern.moto-app.de), URLs use clean
 * paths like /children/123 instead of /parents/children/123. The proxy
 * rewrites these to the actual /parents/* routes internally.
 *
 * Absolute cross-host helpers follow operator-url.ts. Parent navigation paths
 * stay deterministic so server rendering and hydration produce the same HTML.
 */

import { requiredPortalHostname } from "~/lib/portal-paths";

/**
 * Returns the public path for navigation inside the parents portal.
 * The result must not depend on `window`, because links render on the server
 * and hydrate on the client. Cross-host links use parentsPortalLoginUrl.
 */
export function parentPath(path: string): string {
  return path.replace(/^\/parents(?=\/|$)/, "") || "/";
}

/**
 * Absolute URL of the parents-portal login page on its OWN host.
 *
 * It is used from the tenant (staff) login to send
 * a guardian-only account to the portal it actually belongs to.
 *
 * NEXT_PUBLIC_PARENTS_HOSTNAME is a host authority and already carries the
 * port (e.g. "parents.localhost:3000"), so no port is appended. The scheme
 * follows the current page so local http stays http.
 *
 * Client-side only — throws on server.
 */
export function parentsPortalLoginUrl(search?: string): string {
  if (typeof window === "undefined") {
    throw new Error("parentsPortalLoginUrl() is client-only.");
  }
  return parentsPortalUrl(`/login${search ?? ""}`);
}

/**
 * Absolute URL of a path on the parents portal's OWN host, like
 * parentsPortalLoginUrl. The public demo (#3468) sends a visitor there in
 * the demo role parent. Client-side only — throws on server.
 */
export function parentsPortalUrl(path: string): string {
  if (typeof window === "undefined") {
    throw new Error("parentsPortalUrl() is client-only.");
  }

  const parentsHostname = requiredPortalHostname("parent");

  return `${window.location.protocol}//${parentsHostname}${path}`;
}
