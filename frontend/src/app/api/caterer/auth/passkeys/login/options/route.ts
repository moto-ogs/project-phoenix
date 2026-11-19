import { authStepProxy } from "~/lib/auth-proxy.server";

// Caterer passkey login (#4497); the frontend origin travels along so the
// backend can check the ceremony runs on the caterer host.

/*
 * Stays (#2352): a sign-in step before any session. The browser's
 * Authorization header carries the step's challenge or enrollment proof; the
 * catalog proxy sends only a session bearer or, on a public route, none.
 * Teaching it to forward a browser credential for these routes would give it
 * a second credential path for one-line files; this file is the smaller
 * boundary.
 */
export const POST = authStepProxy(
  "/caterer/auth/passkeys/login/options",
  "optional-json",
);
