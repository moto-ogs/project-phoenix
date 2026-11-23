import { routes } from "~/lib/contract/school-auth.generated";
import { authStepProxy } from "~/lib/auth-proxy.server";

export const POST = authStepProxy(routes["POST /school/auth/mfa/resend"]);
