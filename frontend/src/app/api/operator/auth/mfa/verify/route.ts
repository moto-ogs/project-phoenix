import { routes } from "~/lib/contract/operator-auth.generated";
import { createPortalLoginRoute } from "~/lib/login-route.server";
import { operatorPortal } from "~/server/auth/operator";

export const POST = createPortalLoginRoute(
  operatorPortal,
  "mfa/verify",
  routes["POST /operator/auth/mfa/verify"],
);
