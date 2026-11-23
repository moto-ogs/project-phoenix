import { routes } from "~/lib/contract/traeger-auth.generated";
import { createPortalLoginRoute } from "~/lib/login-route.server";
import { traegerPortal } from "~/server/auth/traeger";

export const POST = createPortalLoginRoute(
  traegerPortal,
  "mfa/verify",
  routes["POST /traeger/auth/mfa/verify"],
);
