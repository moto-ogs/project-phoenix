import { routes } from "~/lib/contract/caterer-auth.generated";
import { authStepProxy } from "~/lib/auth-proxy.server";

export const POST = authStepProxy(routes["POST /caterer/auth/mfa/resend"]);
