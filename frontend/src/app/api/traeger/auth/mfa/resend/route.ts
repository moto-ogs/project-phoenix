import { routes } from "~/lib/contract/traeger-auth.generated";
import { authStepProxy } from "~/lib/auth-proxy.server";

export const POST = authStepProxy(routes["POST /traeger/auth/mfa/resend"]);
