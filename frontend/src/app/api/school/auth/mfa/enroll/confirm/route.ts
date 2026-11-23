import { routes } from "~/lib/contract/school-auth.generated";
import { createPortalLoginRoute } from "~/lib/login-route.server";
import { schoolPortal } from "~/server/auth/school";

export const POST = createPortalLoginRoute(
  schoolPortal,
  "mfa/enroll/confirm",
  routes["POST /school/auth/mfa/enroll/confirm"],
);
