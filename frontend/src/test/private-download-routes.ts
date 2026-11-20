/**
 * Private, session- or token-bound file routes. Audited for #5119. A file
 * route the contract registers (`response: fileAnswer`) has no route file:
 * the portal's catalog proxy answers it private and uncached
 * (catalog-proxy.server.ts, #2352), and `route-cache-policy.test.ts` keeps
 * it out of this list.
 */
export const PRIVATE_DOWNLOAD_ROUTES = [["students/export", "POST"]] as const;
