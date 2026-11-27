import type { ErrorCode } from "~/lib/error-codes.generated";
import { parseRetryAfter } from "~/lib/retry-after";

const catalogValues = new WeakMap<ApiError, Record<string, unknown>>();

export function apiErrorCatalogValues(
  error: ApiError,
): Record<string, unknown> {
  return catalogValues.get(error) ?? {};
}

async function decodeCatalogValues(error: ApiError): Promise<void> {
  if (!error.code || !error.details) return;
  const { problemDetails } =
    await import("~/lib/contract/problem-details.generated");
  const code = error.code as keyof typeof problemDetails;
  if (!Object.hasOwn(problemDetails, code)) return;
  const decoded = problemDetails[code].safeParse(error.details);
  if (decoded.success && isProblemRecord(decoded.data)) {
    catalogValues.set(error, decoded.data);
  }
}

/**
 * Types a wire code for comparison against registry codes, so a literal that
 * is not in error-registry/ fails the type check. The value itself is not
 * validated: an unknown code simply never equals a registered one.
 */
export function wireErrorCode(code: unknown): ErrorCode | undefined {
  return typeof code === "string" && code ? (code as ErrorCode) : undefined;
}

/** Structured HTTP failure shared by browser and domain clients. */
export class ApiError extends Error {
  status?: number;
  code?: ErrorCode;
  /** Backend diagnostic detail. It is for logs, never for user-facing copy. */
  detail?: string;
  /** @rawProblemDetails Read business fields through a generated decoder. */
  details?: Record<string, unknown>;
  errors?: { field: string; reason: string }[];
  instance?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  /** No HTTP response arrived; the status is a stand-in (unavailableApiError). */
  noResponse?: boolean;
  /** @rawProblemEnvelope Parsed envelope, for passing to a generated refusal decoder. */
  declare readonly problem?: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    status?: number,
    payload?: {
      code?: string;
      detail?: string;
      details?: Record<string, unknown>;
      errors?: { field: string; reason: string }[];
      instance?: string;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code =
      wireErrorCode(payload?.code) ||
      (status === undefined ? undefined : errorClassCode(status));
    this.detail = payload?.detail;
    this.details = payload?.details;
    this.errors = payload?.errors;
    this.instance = payload?.instance;
    this.requestId = payload?.instance;
  }
}

/**
 * The server refused a write because what it depends on changed since it was
 * read (`general.changed_since_read`, ADR 0311). The caller shows the stored
 * state again, never offers to resend the same request: that would be
 * refused again.
 */
export function isChangedSinceRead(error: unknown): boolean {
  return (
    error instanceof ApiError && error.code === "general.changed_since_read"
  );
}

/**
 * Older refusals of the same kind with a code of their module (ADR 0311 §6):
 * a preview, import, baseline or form the write was confirmed against has
 * changed since it was read. New ones use `general.changed_since_read`.
 */
const LEGACY_READ_STATE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "care_contract.child_link_changed",
  "care_contract.enrollment_preview_changed",
  "care_contract.import_changed",
  "enrollment.holiday_allocation_changed",
  "enrollment.holiday_registration_form_changed",
  "enrollment.renewal_terms_changed",
  "enrollment.traeger_preview_stale",
  "grade_transition.preview_stale",
  "meals.billing_month_changed",
  "meals.day_changed",
  "parent_billing.billing_run_changed",
  "parent_billing.family_children_import_changed",
  "parent_billing.sepa_debits_changed",
  "parent_billing.sepa_import_changed",
  "parent_billing.sepa_mandate_text_changed",
  "pickup.preview_stale",
  "students.care_exit_preview_changed",
  "students.care_request_plan_changed",
  "students.change_request_stale",
  "students.companions_changed",
  "students.deletion_constraints_changed",
  "students.deletion_preview_changed",
  "students.pickup_change_impact_changed",
  "timetable.closing_day_notice_changed",
  "timetable.completion_confirmation_stale",
  "timetable.template_booking_gap_stale",
  "traeger.closing_day_bookings_changed",
  "workforce.traeger_staff_import_changed",
]);

/**
 * The server refused a write because the state it was confirmed against is
 * no longer the stored one: `general.changed_since_read` or one of the older
 * module codes of the same meaning. The same request would be refused
 * again; the surface shows the stored state, never a retry
 * (`show(error, { reload })` of the error path does both).
 */
export function isReadStateRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code !== undefined &&
    (error.code === "general.changed_since_read" ||
      LEGACY_READ_STATE_CODES.has(error.code))
  );
}

/** Mirrors backend/api/common.ErrorClassCode until generated contracts include it. */
export function errorClassCode(status: number): ErrorCode {
  if (status === 401 || status === 403) return "general.permission";
  if (status === 413 || status === 431) return "general.request_too_large";
  if (status === 409 || status === 410 || status === 422)
    return "general.business_rejection";
  if ([408, 429, 499, 502, 503, 504].includes(status))
    return "general.unavailable";
  return status >= 500 ? "general.server" : "general.input";
}

/** A request failed before the API could return an HTTP response. */
export function unavailableApiError(cause?: unknown): ApiError {
  const message =
    cause instanceof Error && cause.message
      ? cause.message
      : "Network request failed";
  const error = new ApiError(message, 503, {
    code: "general.unavailable",
  });
  if (cause instanceof Error && cause.name) error.name = cause.name;
  error.noResponse = true;
  return error;
}

/**
 * The RFC 9457 error body every API answer carries (ADR 0006). `status` is the
 * HTTP status number, `detail` is developer diagnostics and never shown; the
 * user reads the catalog text for `code`.
 */
export interface ProblemBody {
  type?: string;
  title?: string;
  status: number;
  detail: string;
  instance?: string;
  code: ErrorCode;
  errors?: { field: string; reason: string }[];
  details?: Record<string, unknown>;
}

/**
 * Builds the envelope for an error that starts in the frontend's own server
 * layer, so the browser reads it like a backend answer. Without a code the
 * error carries the code of its class.
 */
export function problemBody(
  status: number,
  detail: string,
  extra: Omit<Partial<ProblemBody>, "status" | "detail"> = {},
): ProblemBody {
  return {
    type: "about:blank",
    title: problemTitle(status),
    ...extra,
    status,
    detail,
    code: wireErrorCode(extra.code) ?? errorClassCode(status),
  };
}

export function problemTitle(status: number): string {
  const titles: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    412: "Precondition Failed",
    413: "Content Too Large",
    422: "Unprocessable Content",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return titles[status] ?? (status >= 500 ? "Server Error" : "Client Error");
}

/** The diagnostic `detail` of an error body, for logs and error messages. */
export function problemDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const detail = (body as { detail?: unknown }).detail;
  return typeof detail === "string" && detail.trim() ? detail : undefined;
}

type SessionRefusalListener = (code: ErrorCode) => void;

const sessionTenantMismatchListeners = new Set<SessionRefusalListener>();

/**
 * The BFF's refusals of a session that no longer fits the tab: another
 * school than this subdomain (#5130) or another account than the one the
 * tab holds data for (#5183).
 */
const SESSION_REFUSAL_CODES: ReadonlySet<ErrorCode> = new Set([
  "identity.session_tenant_mismatch",
  "identity.session_account_mismatch",
]);

export function isSessionRefusalCode(code: unknown): code is ErrorCode {
  const wire = wireErrorCode(code);
  return wire !== undefined && SESSION_REFUSAL_CODES.has(wire);
}

/**
 * Who learns that the BFF refused a request because the session no longer
 * fits this tab: it belongs to another school than this subdomain (#5130)
 * or to another account than the tab's (#5183). The session cache drops its
 * session and wakes the SessionProvider; TenantGuard hides the page until
 * the provider's answer is known and then switches back. Another account
 * resets the SWR scope (SWRScopeBoundary) and leaves the page
 * (PersonalStorageGuard). Error answers that become an ApiError report here,
 * and the fetch observer reports every fetch answer, also of clients that
 * never read the body. Returns the unsubscribe function.
 */
export function onSessionTenantMismatch(
  listener: SessionRefusalListener,
): () => void {
  sessionTenantMismatchListeners.add(listener);
  return () => {
    sessionTenantMismatchListeners.delete(listener);
  };
}

export function reportSessionTenantMismatch(
  code: ErrorCode = "identity.session_tenant_mismatch",
): void {
  for (const listener of sessionTenantMismatchListeners) listener(code);
}

/**
 * Turns an error body into an ApiError. The caller supplies the user-safe
 * message; the envelope's diagnostic `detail` remains separate for logs.
 */
export function apiErrorFromBody(
  message: string,
  status: number,
  body: unknown,
): ApiError {
  const data = isProblemRecord(body) ? body : {};
  const details = isProblemRecord(data.details) ? data.details : undefined;
  const errors = Array.isArray(data.errors)
    ? data.errors.filter(
        (entry): entry is { field: string; reason: string } =>
          !!entry &&
          typeof entry === "object" &&
          typeof entry.field === "string" &&
          typeof entry.reason === "string",
      )
    : undefined;
  const error = new ApiError(message, status, {
    code: typeof data.code === "string" && data.code ? data.code : undefined,
    detail: problemDetail(data),
    details,
    errors,
    instance: typeof data.instance === "string" ? data.instance : undefined,
  });
  // Not enumerable: two errors with the same status, code and text stay equal.
  if (body && typeof body === "object") {
    Object.defineProperty(error, "problem", { value: data });
  }
  if (isSessionRefusalCode(error.code)) {
    reportSessionTenantMismatch(error.code);
  }
  return error;
}

export function isProblemRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * For clients that already read the body as text: keeps their message and
 * takes code, field errors and request ID from the envelope when the text is
 * JSON.
 */
function apiErrorFromText(
  message: string,
  status: number,
  text: string,
): ApiError {
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return apiErrorFromBody(message, status, body);
}

/**
 * For clients that hold the failed `Response`: keeps their message and takes
 * code, field errors and request ID from the envelope. A body that cannot be
 * read still yields the status class.
 */
export async function apiErrorFromResponse(
  response: Response,
  message: string,
): Promise<ApiError> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    // Body already consumed or the stream broke: the status still classifies.
  }
  const error = apiErrorFromText(message, response.status, text);
  try {
    await decodeCatalogValues(error);
  } catch {
    // An unavailable lazy chunk must not hide the original refusal.
  }
  // A refusal with a wait (429, 503) tells the screen when to try again.
  let retryAfter: number | null = null;
  try {
    retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
  } catch {
    // Without readable headers there is no wait to report.
  }
  if (retryAfter !== null) error.retryAfterSeconds = retryAfter;
  return error;
}
