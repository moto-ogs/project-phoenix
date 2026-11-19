import { problemResponse } from "~/lib/api-helpers.server";
import { createPublicJsonProxy } from "~/lib/backend-proxy-route.server";

// Beitrag der öffentlichen Ferienanmeldung (#4664) für die Zusammenfassung
// vor dem Absenden: ohne Sitzung, nur die Buchungen, nichts wird gespeichert.
//
// Temporary (#2352): the form asks /api/traeger/holiday-quotes/{token}
// through the Träger proxy's public routes since this release. This path
// stays for an open form with an older bundle; delete it with its test after
// the next production deploy.
export const POST = createPublicJsonProxy({
  method: "POST",
  path: (request, params) => {
    const token = params.token;
    if (typeof token !== "string" || !token) {
      return problemResponse(400, "token required", request);
    }
    return `/traeger/holiday-quotes/${encodeURIComponent(token)}`;
  },
});
