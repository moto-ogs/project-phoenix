import { routes } from "~/lib/contract/caterer-auth.generated";
import { authStepProxy } from "~/lib/auth-proxy.server";

// Caterer passkey login (#4497); the frontend origin travels along so the
// backend can check the ceremony runs on the caterer host.
export const POST = authStepProxy(
  routes["POST /caterer/auth/passkeys/login/options"],
);
