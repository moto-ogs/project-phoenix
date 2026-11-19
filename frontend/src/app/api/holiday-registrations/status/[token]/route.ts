import { problemResponse } from "~/lib/api-helpers.server";
import { createPublicJsonProxy } from "~/lib/backend-proxy-route.server";

// Stand einer Ferienanmeldung (#6676): der geheime Link aus der
// Eingangsmail, ohne Sitzung. Der Token ist der einzige Schlüssel.
//
// Temporary (#2352): the status page reads
// /api/traeger/holiday-registrations/status/{token} through the Träger
// proxy's public routes since this release. This path stays for an open page
// with an older bundle; delete it after the next production deploy.
export const GET = createPublicJsonProxy({
  method: "GET",
  path: (request, params) => {
    const token = params.token;
    if (typeof token !== "string" || !token) {
      return problemResponse(400, "token required", request);
    }
    return `/traeger/holiday-registrations/status/${encodeURIComponent(token)}`;
  },
});
