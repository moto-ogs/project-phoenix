import { ApiError } from "~/lib/api-error";

type EnrollmentErrorLogger = {
  error: (message: string, context?: Record<string, unknown>) => void;
  warn?: (message: string, context?: Record<string, unknown>) => void;
};

/**
 * Logs a failed enrollment call and rethrows it (#2515). The ApiError keeps
 * code, field errors, details and request ID for the shared error path,
 * which picks the text from the catalog; the backend sentence (`detail`)
 * goes to the log only (ADR 0006: never shown).
 */
export function logEnrollmentFailure(
  error: unknown,
  logger: EnrollmentErrorLogger,
  event: string,
): never {
  if (error instanceof ApiError && error.status !== undefined) {
    const context = {
      status: error.status,
      code: error.code,
      requestId: error.requestId,
      rawMessage: error.detail,
    };
    if (error.status >= 500 || !logger.warn) {
      logger.error(event, context);
    } else {
      logger.warn(event, context);
    }
  }
  throw error;
}
