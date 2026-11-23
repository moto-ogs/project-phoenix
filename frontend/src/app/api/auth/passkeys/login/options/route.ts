import { routes } from "~/lib/contract/auth-passkeys.generated";
import { authStepProxy } from "~/lib/auth-proxy.server";

export const POST = authStepProxy(routes["POST /auth/passkeys/login/options"]);
