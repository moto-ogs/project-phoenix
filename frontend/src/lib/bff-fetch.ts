import { apiErrorFromResponse } from "./api-error";
import type { ApiResponse } from "./api-envelope";
import { sessionFetch } from "./session-cache";

interface BffRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON-serialized, or sent as is when it is FormData. */
  body?: unknown;
  signal?: AbortSignal;
  headers?: Readonly<Record<string, string>>;
}

/**
 * Calls a tenant BFF route and returns the `data` of its answer. Every
 * success has the backend's envelope `{ status, data }`; a failure
 * becomes an ApiError with the backend's code, field errors and request ID,
 * and a 204 resolves to undefined.
 */
export async function bffJson<T>(
  url: string,
  { method = "GET", body, signal, headers }: BffRequest = {},
): Promise<T> {
  const response = await sessionFetch(url, {
    method,
    signal,
    ...(headers && { headers }),
    ...(body !== undefined && {
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `${method} ${url} failed (${response.status})`,
    );
  }
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as ApiResponse<T>).data;
}
