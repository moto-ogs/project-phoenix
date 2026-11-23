import { routes } from "~/lib/contract/auth-mfa.generated";
import { authStepProxy } from "~/lib/auth-proxy.server";

export const POST = authStepProxy(routes["POST /auth/mfa/enroll/start"]);
