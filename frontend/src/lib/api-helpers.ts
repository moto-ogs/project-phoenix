// lib/api-helpers.ts
import { ApiError, apiErrorFromBody, type ProblemBody } from "./api-error";

/** The error body of an API answer: the RFC 9457 envelope (ADR 0006). */
export type ApiErrorResponse = ProblemBody;

/**
 * Generic domain API error handler: every failure leaves as an ApiError, so
 * the shared display path reads its status and code. A failure that carries
 * a response keeps its envelope; anything without a response is a server
 * fault.
 * @param error - The caught error
 * @param context - Description of the failed operation
 */
export function handleDomainApiError(error: unknown, context: string): never {
  if (error instanceof ApiError) throw error;
  const response =
    error !== null && typeof error === "object" && "response" in error
      ? (error as { response?: { status?: unknown; data?: unknown } }).response
      : undefined;
  if (response && typeof response.status === "number") {
    throw apiErrorFromBody(
      `Failed to ${context}`,
      response.status,
      response.data,
    );
  }
  throw new ApiError(
    `Failed to ${context}: ${error instanceof Error ? error.message : "Unknown error"}`,
    500,
  );
}
