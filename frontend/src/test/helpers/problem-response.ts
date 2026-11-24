import { apiErrorFromResponse } from "~/lib/api-error";

export function errorFromProblem(
  message: string,
  status: number,
  payload: { code: string; detail?: string; details: unknown },
) {
  return apiErrorFromResponse(Response.json(payload, { status }), message);
}
