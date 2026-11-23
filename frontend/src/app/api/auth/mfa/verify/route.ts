import { routes } from "~/lib/contract/auth-mfa.generated";
import { createPortalLoginRoute } from "~/lib/login-route.server";
import { tenantPortal } from "~/server/auth";

export const POST = createPortalLoginRoute(
  tenantPortal,
  "mfa/verify",
  routes["POST /auth/mfa/verify"],
);
