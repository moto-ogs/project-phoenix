import { NextResponse } from "next/server";
import { createLogger } from "~/lib/logger";
import { captureBffException } from "~/lib/sentry-bff.server";
import {
  ApiError,
  errorClassCode,
  problemBody,
  problemTitle,
  type ProblemBody,
} from "./api-error";
import { ERROR_CODES } from "./error-codes.generated";
import { requestInstance } from "./request-id";

const logger = createLogger({ component: "ApiHelpers" });
const registeredErrorCodes: ReadonlySet<string> = new Set(ERROR_CODES);

type JsonBody = Record<string, unknown> | unknown[] | string | number | boolean;

/**
 * Typed error thrown by serverFetchWithRetry for non-OK backend responses and
 * by the route wrappers for failures they detect themselves. Carries the HTTP
 * status and the raw body so callers branch on the status or the envelope's
 * code, never on the message.
 */
export class ApiResponseError extends Error {
  readonly status: number;
  readonly bodyText: string;
  readonly retryAfter: string | null;
  readonly contentType: string | null;
  /** Headers arrived, but the response stream did not finish. */
  readonly bodyInterrupted: boolean;
  // Memoized parse result — `null` means "not JSON". Lazy so callers that
  // only check status never pay the JSON.parse cost.
  private parsedBody: JsonBody | null = null;
  private parseAttempted = false;

  constructor(
    status: number,
    bodyText: string,
    options?: ErrorOptions & {
      retryAfter?: string | null;
      contentType?: string | null;
      bodyInterrupted?: boolean;
    },
  ) {
    super(`API error (${status}): ${bodyText}`, options);
    this.name = "ApiResponseError";
    this.status = status;
    this.bodyText = bodyText;
    this.retryAfter = options?.retryAfter ?? null;
    this.contentType = options?.contentType ?? null;
    this.bodyInterrupted = options?.bodyInterrupted ?? false;
  }

  /** Returns the parsed JSON body, or `null` if the body isn't valid JSON. */
  body<T = unknown>(): T | null {
    if (!this.parseAttempted) {
      this.parseAttempted = true;
      try {
        this.parsedBody = JSON.parse(this.bodyText) as JsonBody;
      } catch {
        this.parsedBody = null;
      }
    }
    return (this.parsedBody ?? null) as T | null;
  }
}

/**
 * The backend could not be reached or sent no response headers in time: the
 * service is unavailable (503 general.unavailable), not an internal error.
 * The cause is reported once where the route answers (handleApiError).
 */
export class BackendUnavailableError extends ApiResponseError {
  constructor(cause: unknown) {
    super(
      503,
      JSON.stringify(
        problemBody(503, problemTitle(503), { code: "general.unavailable" }),
      ),
      { contentType: "application/problem+json", cause },
    );
    this.name = "BackendUnavailableError";
  }
}

export function isApiResponseError(
  error: unknown,
  status?: number,
): error is ApiResponseError {
  return (
    error instanceof ApiResponseError &&
    (status === undefined || error.status === status)
  );
}

/**
 * A failure the frontend's server layer detects itself (bad JSON, oversized
 * body, missing session). It carries the same envelope as a backend answer,
 * so handleApiError forwards it unchanged.
 */
export function bffError(
  status: number,
  detail: string,
  extra?: Omit<Partial<ProblemBody>, "status" | "detail">,
): ApiResponseError {
  // Same rule as problemResponse: a 5xx keeps its cause on the server.
  const publicDetail = status >= 500 ? problemTitle(status) : detail;
  return new ApiResponseError(
    status,
    JSON.stringify(problemBody(status, publicDetail, extra)),
    { contentType: "application/problem+json" },
  );
}

/**
 * Answers with the error envelope for a failure that starts in the frontend's
 * own API route, so the browser reads it like a backend answer. A 5xx never
 * sends its cause to the browser: an exception message can carry hostnames,
 * stack details or upstream text, so the detail is the status title and the
 * caller logs the real cause server-side.
 */
type ProblemResponseExtra = Omit<Partial<ProblemBody>, "status" | "detail">;

export function problemResponse(
  status: number,
  detail: string,
  request?: Request,
): NextResponse<ProblemBody>;
export function problemResponse(
  status: number,
  detail: string,
  extra?: ProblemResponseExtra,
  headers?: HeadersInit,
): NextResponse<ProblemBody>;
export function problemResponse(
  status: number,
  detail: string,
  extra: ProblemResponseExtra | undefined,
  request?: Request,
  headers?: HeadersInit,
): NextResponse<ProblemBody>;
export function problemResponse(
  status: number,
  detail: string,
  extraOrRequest?: ProblemResponseExtra | Request,
  requestOrHeaders?: Request | HeadersInit,
  headers?: HeadersInit,
): NextResponse<ProblemBody> {
  const request = isRequest(extraOrRequest)
    ? extraOrRequest
    : isRequest(requestOrHeaders)
      ? requestOrHeaders
      : undefined;
  const extra = isRequest(extraOrRequest) ? undefined : extraOrRequest;
  const responseHeaders = new Headers(
    isRequest(requestOrHeaders) ? headers : (requestOrHeaders ?? headers),
  );
  responseHeaders.set("Content-Type", "application/problem+json");
  const publicDetail = status >= 500 ? problemTitle(status) : detail;
  return NextResponse.json(
    problemBody(
      status,
      publicDetail,
      publicProblemExtensions(status, extra, request),
    ),
    {
      status,
      headers: responseHeaders,
    },
  );
}

function publicProblemExtensions(
  status: number,
  extra: ProblemResponseExtra | undefined,
  request: Request | undefined,
): ProblemResponseExtra {
  const instance = extra?.instance ?? requestInstance(request);
  if (status < 500) return { ...extra, instance };

  // A 5xx can contain backend diagnostics in every extension, not only in
  // `detail`. Keep its code and only explicitly allowed, sanitized details;
  // the instance correlates the response with server logs.
  const code =
    extra?.code && registeredErrorCodes.has(extra.code) ? extra.code : null;
  return {
    ...(code ? { code } : {}),
    ...(code && CLIENT_DETAILS_SERVER_ERROR_CODES.has(code) && extra?.details
      ? { details: safeImportDetails(extra.details) }
      : {}),
    ...(instance ? { instance } : {}),
  };
}

function isRequest(value: unknown): value is Request {
  return (
    value !== null &&
    typeof value === "object" &&
    "headers" in value &&
    typeof (value as Request).headers?.get === "function"
  );
}

/**
 * Answers a failed API route with Problem Details. Valid backend problems
 * below 500 keep their fields and may gain a request ID. Invalid bodies,
 * backend 5xx and frontend errors get a safe problem instead.
 * @param error Error object
 * @returns Response with the error envelope and status
 */
export function handleApiError(
  error: unknown,
  request?: Request,
): NextResponse<ProblemBody> {
  if (error instanceof BackendUnavailableError) {
    captureBffException(error.cause, request);
  }
  if (error instanceof ApiResponseError) {
    const parsed = error.body<unknown>();
    const isEnvelope = isProblemEnvelope(parsed, error.status);
    logApiRouteError(
      error.status,
      parsed === null
        ? error.bodyText
        : JSON.stringify(redactSensitiveApiErrorValue(parsed)),
      isEnvelope ? parsed.code : undefined,
    );
    const headers = new Headers();
    if (error.retryAfter) headers.set("Retry-After", error.retryAfter);
    if (!isEnvelope || error.status >= 500) {
      // An invalid upstream body or a 5xx can carry proxy or backend
      // diagnostics. The body is logged above and never forwarded: the
      // browser gets an envelope with the status title. A validated registry
      // code remains the error identity; free-text extensions stay server-side.
      return problemResponse(
        error.status,
        problemTitle(error.status),
        safeProblemExtensions(parsed, error.status),
        request,
        headers,
      );
    }
    const instance = requestInstance(request);
    if (error.contentType) headers.set("Content-Type", error.contentType);
    if (instance && !parsed.instance) {
      return new NextResponse<ProblemBody>(
        JSON.stringify({ ...parsed, instance }),
        { status: error.status, headers },
      );
    }
    return new NextResponse<ProblemBody>(error.bodyText, {
      status: error.status,
      headers,
    });
  }

  if (error instanceof ApiError && error.status !== undefined) {
    // The message is diagnostics from this server: it is logged, the browser
    // reads the code.
    const code =
      error.code && registeredErrorCodes.has(error.code)
        ? error.code
        : errorClassCode(error.status);
    logApiRouteError(error.status, error.message, code);
    return problemResponse(
      error.status,
      problemTitle(error.status),
      {
        code,
        errors: error.errors,
        details: error.details,
        instance: error.instance,
      },
      request,
    );
  }

  if (isClientDisconnect(error, request)) {
    // The browser closed the connection while its body was being read
    // (navigation, superseded request). Nobody receives this response and no
    // code failed, so it is no Sentry event (FRONTEND-1C).
    logger.debug("api_route_client_aborted");
    return problemResponse(400, problemTitle(400), undefined, request);
  }

  // Unknown errors are logged as errors and return 500
  captureBffException(error, request);
  logger.error("api route error without status", {
    error: error instanceof Error ? error.message : String(error),
  });
  return problemResponse(500, "internal error", request);
}

// Node rejects an incoming request's body with `Error("aborted")` and code
// ECONNRESET when the client disconnects before the body is complete. A
// failed backend fetch is a TypeError that carries ECONNRESET on its cause
// only, so it is still reported.
function isClientDisconnect(error: unknown, request?: Request): boolean {
  if (request?.signal?.aborted) return true;
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "ECONNRESET"
  );
}

function isProblemEnvelope(
  value: unknown,
  status: number,
): value is ProblemBody {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const body = value as Record<string, unknown>;
  const code = body.code;
  return (
    body.status === status &&
    hasNonEmptyString(body, "type") &&
    hasNonEmptyString(body, "title") &&
    hasNonEmptyString(body, "detail") &&
    typeof code === "string" &&
    code.trim() !== "" &&
    registeredErrorCodes.has(code) &&
    !("error" in body) &&
    !("message" in body)
  );
}

/**
 * Keeps only a validated error identity when replacing a backend 5xx body.
 * Other extensions can contain diagnostics just like `detail`, so a generic
 * proxy cannot decide that they are safe to send to the browser; the codes
 * of CLIENT_DETAILS_SERVER_ERROR_CODES keep their sanitized `details`.
 */
export function safeProblemExtensions(
  value: unknown,
  status: number,
): Omit<Partial<ProblemBody>, "status" | "detail"> {
  if (!isProblemEnvelope(value, status)) return {};
  const details = value.details;
  if (
    CLIENT_DETAILS_SERVER_ERROR_CODES.has(value.code) &&
    details !== null &&
    typeof details === "object" &&
    !Array.isArray(details)
  ) {
    return { code: value.code, details: safeImportDetails(details) };
  }
  return { code: value.code };
}

/**
 * Server-error codes whose `details` the backend writes for the person who
 * acted, not as diagnostics: an import whose later batch failed names the
 * rows it already saved (#3184), and the page shows them. Row diagnostics
 * are replaced, including those restored from older checkpoints. Every other 5xx
 * keeps only its code.
 */
const CLIENT_DETAILS_SERVER_ERROR_CODES: ReadonlySet<string> = new Set([
  "import.import_batch_failed",
]);

const importDiagnosticMessages: Readonly<Record<string, string>> = {
  opening_preflight_failed:
    "Die Übernahme konnte nicht geprüft werden. Bitte versuche es erneut.",
  vacation_opening_preflight_failed:
    "Die Übernahme konnte nicht geprüft werden. Bitte versuche es erneut.",
  existing_lookup_failed:
    "Die Zeile konnte nicht geprüft werden. Bitte versuche es erneut.",
  rfid_lookup_failed:
    "Die Karte konnte nicht geprüft werden. Bitte versuche es erneut.",
  role_lookup_failed:
    "Die Rolle konnte nicht geprüft werden. Bitte versuche es erneut.",
  creation_failed:
    "Die Zeile konnte nicht gespeichert werden. Bitte versuche es erneut.",
  update_failed:
    "Die Zeile konnte nicht gespeichert werden. Bitte versuche es erneut.",
  duplicate_check_failed:
    "Die Zeile konnte nicht geprüft werden. Bitte versuche es erneut.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Keep the saved outcome, but never expose database diagnostics from row failures. */
function safeImportDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const result = details.result;
  if (!isRecord(result) || !Array.isArray(result.errors)) return details;
  return {
    ...details,
    result: {
      ...result,
      errors: result.errors.map((row: unknown) => {
        if (!isRecord(row) || !Array.isArray(row.errors)) return row;
        return {
          ...row,
          errors: row.errors.map((error: unknown) => {
            if (!isRecord(error) || typeof error.code !== "string")
              return error;
            const message = Object.hasOwn(importDiagnosticMessages, error.code)
              ? importDiagnosticMessages[error.code]
              : undefined;
            if (!message) return error;
            return {
              field: error.field,
              code: error.code,
              severity: error.severity,
              message,
            };
          }),
        };
      }),
    },
  };
}

function hasNonEmptyString(
  body: Record<string, unknown>,
  member: string,
): boolean {
  const value = body[member];
  return typeof value === "string" && value.trim() !== "";
}

function logApiRouteError(
  status: number,
  safeErrorMessage: string,
  errorCode: string | undefined,
): void {
  // Only log server errors (5xx) to avoid Next.js error overlay for expected 4xx.
  // Backend 5xx responses stay in logs; the backend owns their Sentry event.
  if (status >= 500) {
    logger.error("api route error", {
      status,
      error: safeErrorMessage,
      ...(errorCode && { error_code: errorCode }),
    });
    return;
  }

  if (status === 429) {
    logger.warn("api route rate limited", {
      status,
      error: safeErrorMessage,
      rate_limited: true,
    });
    return;
  }

  logger.warn("api route error", {
    status,
    error: safeErrorMessage,
  });
}

/**
 * JSON keys whose free-text values must not appear in server logs, even when
 * a 4xx body still carries them (sick-note content).
 */
const SENSITIVE_API_ERROR_KEYS = new Set(["note"]);

function redactSensitiveApiErrorValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveApiErrorValue(entry));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_API_ERROR_KEYS.has(key) && entry != null && entry !== "") {
      redacted[key] = "[REDACTED]";
      continue;
    }
    redacted[key] = redactSensitiveApiErrorValue(entry);
  }
  return redacted;
}
