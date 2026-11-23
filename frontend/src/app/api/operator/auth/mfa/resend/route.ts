import { routes } from "~/lib/contract/operator-auth.generated";
import { authStepProxy } from "~/lib/auth-proxy.server";

export const POST = authStepProxy(routes["POST /operator/auth/mfa/resend"]);
