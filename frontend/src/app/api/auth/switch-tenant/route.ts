import { invalidJsonResponse } from "~/lib/route-wrapper-utils.server";
import { tenantPortal } from "~/server/auth";
import { sessionMutationOriginError } from "~/server/auth/same-origin";
import { handleApiError } from "~/lib/api-response-error.server";
import { contractWrite } from "~/lib/contract/client.server";
import { contractError } from "~/lib/contract/route-response.server";
import {
  routes,
  type SwitchTenantRequest,
} from "~/lib/contract/auth-switch-tenant.generated";
import { installLoginSession } from "~/lib/login-route.server";
import { tenant } from "~/lib/route-wrapper.server";
import { successResponse } from "~/lib/route-wrapper-utils.server";

export const POST = tenantPortal.withAuth(async (request) => {
  const originError = sessionMutationOriginError(request);
  if (originError) return originError;
  let body: SwitchTenantRequest;
  try {
    body = await request.json();
  } catch {
    return invalidJsonResponse(request);
  }
  try {
    const reply = await contractWrite(
      routes["POST /auth/switch-tenant"],
      body,
      {
        send: (path, call) =>
          tenant.backendFetch(request, path, {
            ...call,
            retry: {
              off: "its 401 names why the switch is refused (identity.mfa_session_required)",
            },
          }),
      },
    );
    if (!reply.ok) return contractError(reply, request);
    const failure = await installLoginSession(
      request,
      reply.value,
      tenantPortal,
    );
    return failure ?? Response.json(successResponse(null));
  } catch (error) {
    return handleApiError(error, request);
  }
});
