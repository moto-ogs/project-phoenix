import type { NextRequest } from "next/server";
import { handleApiError } from "./api-response-error.server";
import { noData } from "./contract/runtime";
import {
  contractWrite,
  type ContractBody,
  type ContractOptions,
} from "./contract/client.server";
import { contractResponse } from "./contract/route-response.server";
import { withPrivateNoStore } from "./private-no-store";
import { successResponse } from "./route-wrapper-utils.server";

/**
 * MFA resend, enrollment start and passkey options carry no session.
 * The Authorization header, if present, is the step's limited proof.
 */
export function authStepProxy<
  R extends Parameters<typeof contractWrite>[0] & {
    method: "POST";
    routeFile: string;
  },
>(route: R & (R["pattern"] extends `${string}{${string}` ? never : unknown)) {
  return withPrivateNoStore(async (request: NextRequest) => {
    // The Go route validates the body it binds.
    const body: ContractBody<R> =
      "request" in route
        ? await request.json().catch(() => ({}))
        : (undefined as ContractBody<R>);
    const proof = request.headers.get("authorization");
    try {
      const reply = await contractWrite<R>(
        route,
        body,
        ...([
          {
            request,
            timeout: "login",
            headers: proof ? { Authorization: proof } : undefined,
          },
        ] as unknown as ContractOptions<NoInfer<R>>),
      );
      return route.response === noData
        ? contractResponse(reply, request)
        : contractResponse(reply, request, successResponse);
    } catch (error) {
      return handleApiError(error, request);
    }
  });
}
