import { routes } from "~/lib/contract/auth-passkeys.generated";
import { createPortalLoginRoute } from "~/lib/login-route.server";
import { tenantPortal } from "~/server/auth";

export const POST = createPortalLoginRoute(
  tenantPortal,
  "passkeys/login/verify",
  routes["POST /auth/passkeys/login/verify"],
);
