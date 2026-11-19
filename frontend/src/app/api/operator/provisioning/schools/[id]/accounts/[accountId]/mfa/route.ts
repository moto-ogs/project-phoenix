// Temporary (#7563): the operator client calls GET and DELETE
// /api/operator/schools/{id}/accounts/{accountId}/mfa
// through the operator portal's catalog proxy since #2352, which checks the
// answer against the contract. This /provisioning/ path stays for an open tab
// with an older bundle; delete the file after the next production deploy.
import { operatorErrorResponse } from "~/lib/operator/route-wrapper.server";
import { createOperatorJsonProxy } from "~/lib/operator/route-wrapper.server";

const path = (
  _request: Request,
  params: Record<string, string | string[] | undefined>,
) => {
  const schoolId = params.id;
  const accountId = params.accountId;
  if (typeof schoolId !== "string" || typeof accountId !== "string") {
    return operatorErrorResponse(
      400,
      "general.input",
      "Invalid school or account parameter",
    );
  }
  return `/operator/schools/${encodeURIComponent(schoolId)}/accounts/${encodeURIComponent(accountId)}/mfa`;
};

export const GET = createOperatorJsonProxy({
  method: "GET",
  path,
});
export const DELETE = createOperatorJsonProxy({
  method: "DELETE",
  path,
  body: "json",
});
