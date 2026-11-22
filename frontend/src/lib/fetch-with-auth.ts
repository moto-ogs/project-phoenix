import { handleAuthFailure } from "./auth-failure";
import { sanitizeEndpoint } from "~/lib/log-sanitize";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "FetchWithAuth" });

interface FetchOptions extends RequestInit {
  retry?: boolean;
}

/**
 * Fetch to a BFF route that, on a 401, asks the session to renew once
 * (handleAuthFailure) and repeats the request. The browser holds no token
 * (#5005). New clients call bffJson (lib/bff-fetch.ts).
 */
export async function fetchWithAuth(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const { retry = true, ...fetchOptions } = options;

  // Make the initial request
  const response = await fetch(url, fetchOptions);

  // If we get a 401 and haven't retried yet, attempt token refresh
  if (response.status === 401 && retry) {
    // Only attempt token refresh on the client side
    if (globalThis.window !== undefined) {
      try {
        // Try to refresh the token and update the session
        const refreshSuccessful = await handleAuthFailure();

        if (refreshSuccessful) {
          // Retry the request with retry=false to prevent infinite loops
          return fetchWithAuth(url, { ...fetchOptions, retry: false });
        }
      } catch (error) {
        logger.error("token refresh failed", {
          url: sanitizeEndpoint(url),
          error: String(error),
        });
      }
    }
  }

  return response;
}
