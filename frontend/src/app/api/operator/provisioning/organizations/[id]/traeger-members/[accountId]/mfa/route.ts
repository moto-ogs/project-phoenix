// Temporary (#7563): the operator client calls DELETE
// /api/operator/organizations/{id}/traeger-members/{accountId}/mfa
// through the operator portal's catalog proxy since #2352, which checks the
// answer against the contract. This /provisioning/ path stays for an open tab
// with an older bundle; delete the file after the next production deploy.
import { operatorErrorResponse } from "~/lib/operator/route-wrapper.server";
import { createOperatorJsonProxy } from "~/lib/operator/route-wrapper.server";

// Zweiten Faktor einer Person im Träger-Büro zurücksetzen (#4651). Die
// Person richtet ihn bei der nächsten Anmeldung im Träger-Portal neu ein.
export const DELETE = createOperatorJsonProxy({
  method: "DELETE",
  path: (_request, params) => {
    const organizationId = params.id;
    const accountId = params.accountId;
    if (typeof organizationId !== "string" || typeof accountId !== "string") {
      return operatorErrorResponse(
        400,
        "general.input",
        "Invalid organization or account parameter",
      );
    }
    return `/operator/organizations/${encodeURIComponent(organizationId)}/traeger-members/${encodeURIComponent(accountId)}/mfa`;
  },
  body: "json",
});
