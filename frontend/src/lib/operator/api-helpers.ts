import { ApiError, apiErrorFromBody, transportFetch } from "../api-error";
import type { ApiResponse } from "../api-envelope";
interface OperatorFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

export async function operatorFetch<T>(
  endpoint: string,
  options: OperatorFetchOptions = {},
): Promise<T> {
  const { method = "GET", body } = options;

  // A request that never reached the API becomes general.unavailable.
  const response = await transportFetch(endpoint, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    // Expired/invalid token → redirect to login immediately
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/operator/login")
    ) {
      window.location.href = "/operator/login";
      throw new ApiError("Session expired", 401);
    }

    const body: unknown = await response.json().catch(() => undefined);
    throw apiErrorFromBody(
      response.statusText || `operator request failed (${response.status})`,
      response.status,
      body,
    );
  }

  if (response.status === 204) {
    return {} as T;
  }

  const json: unknown = await response.json();

  // Unwrap the backend's envelope { status, data, message } (#2353).
  if (
    typeof json === "object" &&
    json !== null &&
    "data" in json &&
    (json as { status?: unknown }).status === "success"
  ) {
    return (json as ApiResponse<T>).data;
  }

  return json as T;
}
