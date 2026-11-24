import { routes } from "~/lib/contract/parent-auth.generated";
import { authStepProxy } from "~/lib/auth-proxy.server";

export const POST = authStepProxy(routes["POST /parent/auth/mfa/resend"]);
