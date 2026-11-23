import { NextResponse } from "next/server";
import { handleApiError } from "~/lib/api-response-error.server";
import { forwardBackendResponse } from "~/lib/backend-proxy-response.server";
import { applyPrivateNoStore } from "~/lib/private-no-store";
import type { ContractReply } from "./client.server";

/** Error answers keep the old forwarding policy, including Retry-After. */
export function contractError(
  reply: ContractReply<never> & { ok: false },
  request: Request,
): NextResponse {
  const { backend, error } = reply;
  const response =
    backend && backend.status >= 400 && error.cause.bodyText
      ? forwardBackendResponse(
          new Response(error.cause.bodyText, {
            status: error.status,
            headers: backend.headers,
          }),
          request,
        )
      : handleApiError(error.cause, request);
  applyPrivateNoStore(response.headers);
  return response;
}

/** Forward only decoded JSON, preserving the backend's status. */
export function contractResponse<T>(
  reply: ContractReply<T>,
  request: Request,
  project: (value: T) => unknown = (value) => value,
): NextResponse {
  if (!reply.ok) return contractError(reply, request);
  const status = reply.backend?.status ?? 200;
  const response =
    status === 204
      ? new NextResponse(null, { status })
      : NextResponse.json(project(reply.value), { status });
  applyPrivateNoStore(response.headers);
  return response;
}
