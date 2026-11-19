import { analyticsSessionHeaders } from "~/lib/analytics-session-header.server";
import { problemResponse } from "~/lib/api-helpers.server";
import { createPublicJsonProxy } from "~/lib/backend-proxy-route.server";
import { canonicalForwardedFor } from "~/lib/client-headers.server";

// Public holiday registration (#4661): the one link of a holiday period, no
// session. The backend counts attempts per client IP, so the canonical
// address travels along.
//
// Temporary (#2352): the client reads and sends the link at
// /api/traeger/holiday-registrations/{token} through the Träger proxy's
// public routes since this release. This path stays for an open form or an
// installed app with an older bundle; delete it with its test after the next
// production deploy. The uploads and documents below stay files.
const path = (
  request: Request,
  params: Record<string, string | string[] | undefined>,
) => {
  const token = params.token;
  if (typeof token !== "string" || !token) {
    return problemResponse(400, "token required", request);
  }
  return `/traeger/holiday-registrations/${encodeURIComponent(token)}`;
};

export const GET = createPublicJsonProxy({
  method: "GET",
  path,
});

export const POST = createPublicJsonProxy({
  method: "POST",
  path,
  additionalHeaders: (request) => {
    const forwardedFor = canonicalForwardedFor(request.headers);
    return {
      ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
      ...analyticsSessionHeaders(request.headers),
    };
  },
});
