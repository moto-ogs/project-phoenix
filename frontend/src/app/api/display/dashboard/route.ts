import type { NextRequest } from "next/server";
import {
  handleApiError,
  problemResponse,
} from "~/lib/api-response-error.server";
import { contractGet } from "~/lib/contract/client.server";
import { contractResponse } from "~/lib/contract/route-response.server";
import { routes } from "~/lib/contract/display.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";

/** The opaque display header, not a browser session, grants backend access. */
export const GET = withPrivateNoStore(async (request: NextRequest) => {
  const token = request.headers.get("x-display-token");
  if (!token) return problemResponse(400, "token required", request);
  try {
    const reply = await contractGet(routes["GET /api/display/dashboard"], {
      request,
      headers: { "X-Display-Token": token },
    });
    return contractResponse(reply, request);
  } catch (error) {
    return handleApiError(error, request);
  }
});
