import { type ApiError, apiErrorFromBody } from "./api-error";
import { createLogger } from "./logger";
import { parseRetryAfter } from "./retry-after";

const logger = createLogger({ component: "ApiErrorResponse" });

/**
 * The structured ApiError of a failed response: code, field errors and
 * request ID from the envelope, its `detail` as the diagnostic message, a
 * plain-text body as the message, and the wait from Retry-After.
 */
export async function buildApiError(
  response: Response,
  fallbackMessage: string,
): Promise<ApiError> {
  let message = fallbackMessage;
  let payload: unknown;

  try {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (
      contentType.includes("application/json") ||
      contentType.includes("+json")
    ) {
      payload = await response.json();
    } else {
      const text = (await response.text()).trim();
      if (text) {
        message = text;
      }
    }
  } catch (parseError) {
    // The status and the fallback text still make an ApiError.
    logger.warn("failed to parse error response", {
      error: String(parseError),
    });
  }

  const apiError = apiErrorFromBody(message, response.status, payload);
  const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
  if (retryAfter !== null) {
    apiError.retryAfterSeconds = retryAfter;
  }
  return apiError;
}
