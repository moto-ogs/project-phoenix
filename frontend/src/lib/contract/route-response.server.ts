import { NextResponse } from "next/server";
import { handleApiError } from "~/lib/api-response-error.server";
import { applyPrivateNoStore } from "~/lib/private-no-store";
import type { ContractReply } from "./client.server";

/** Use the same problem policy as catalog routes, including Retry-After. */
export function contractError(
  reply: Extract<ContractReply<unknown>, { ok: false }>,
  request: Request,
): NextResponse {
  const response = handleApiError(reply.error.cause, request);
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
