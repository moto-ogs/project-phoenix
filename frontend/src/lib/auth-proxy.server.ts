import type { NextRequest } from "next/server";
import { createPublicJsonProxy } from "./backend-proxy-route.server";

/**
 * A login step before a session exists (MFA resend, enrollment start,
 * passkey login options). The browser's Authorization header carries the
 * step's challenge or enrollment proof, not a session token (#5005).
 *
 * Its route files stay beside the catalog proxy (#2352): the proxy sends only
 * a session bearer or, on a public route, none. Teaching it to forward a
 * browser credential for these routes would give it a second credential path
 * for one-line files; a route file per step is the smaller boundary.
 */
export function authStepProxy(path: string, body: "optional-json" | "none") {
  return createPublicJsonProxy({
    method: "POST",
    path,
    body,
    timeout: "login",
    additionalHeaders: (request: NextRequest): Record<string, string> => {
      const proof = request.headers.get("authorization");
      return proof ? { Authorization: proof } : {};
    },
  });
}
