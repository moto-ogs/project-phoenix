import { contractWrite } from "~/lib/contract/client.server";
import { contractResponse } from "~/lib/contract/route-response.server";
import { routes } from "~/lib/contract/auth-staff-preview.generated";
import { handleApiError } from "~/lib/api-response-error.server";
import type { ServerAuthRequest } from "~/server/auth/route-handler";
import { tenantPortal } from "~/server/auth";

/**
 * Ends only the preview held in the httpOnly session, never a browser
 * bearer. The signed preview token is the credential, even after the
 * admin's own session expired; the backend validates it and writes audit.
 */
async function POSTHandler(request: ServerAuthRequest) {
  const session = request.auth;
  const previewToken = session?.user?.isPreview
    ? session.user.token
    : undefined;
  if (!previewToken) return new Response(null, { status: 204 });
  try {
    const reply = await contractWrite(
      routes["POST /auth/staff-preview/end"],
      { preview_token: previewToken },
      { request },
    );
    return contractResponse(reply, request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = tenantPortal.withAuth(POSTHandler);
