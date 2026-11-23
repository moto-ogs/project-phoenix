import { routes } from "~/lib/contract/caterer-auth.generated";
import { createPortalLoginRoute } from "~/lib/login-route.server";
import { catererPortal } from "~/server/auth/caterer";

export const POST = createPortalLoginRoute(
  catererPortal,
  "passkeys/login/verify",
  routes["POST /caterer/auth/passkeys/login/verify"],
);
