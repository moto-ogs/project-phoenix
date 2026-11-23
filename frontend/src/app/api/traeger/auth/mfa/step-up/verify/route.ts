import { routes } from "~/lib/contract/traeger-auth.generated";
import { createFactorConfirmRoute } from "~/lib/factor-routes.server";
import { traeger } from "~/lib/traeger/route-wrapper.server";
import { traegerPortal } from "~/server/auth/traeger";

// The code rotates the running Träger session with the factor proven (#7068).
export const POST = createFactorConfirmRoute({
  portal: traegerPortal,
  handlers: traeger,
  route: routes["POST /traeger/auth/mfa/step-up/verify"],
  retry: { off: "a renewed session would redeem the code twice" },
  log: {
    component: "TraegerStepUpVerifyRoute",
    event: "traeger_step_up_verify_failed",
  },
});
