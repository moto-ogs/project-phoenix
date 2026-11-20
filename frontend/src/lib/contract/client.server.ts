// Reads a registered route and checks the answer against its generated
// decoder (ADR 0270). A backend error and an answer that does not match the
// contract both come back as a typed failure, never as an empty value.
import type { z } from "zod";
import { apiGet, apiPost, apiPut } from "~/lib/api-helpers.server";
import { wireErrorCode } from "~/lib/api-error";
import {
  ApiResponseError,
  bffError,
  isApiResponseError,
} from "~/lib/api-response-error.server";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { createLogger } from "~/lib/logger";
import type { RequestBody } from "./runtime";

const logger = createLogger({ component: "Contract" });

interface ContractFailure {
  status: number;
  /** The registry code of the RFC 9457 body, when the backend sent one. */
  code: ErrorCode | undefined;
  /** The request ID the backend named in `instance`. */
  requestId: string | undefined;
  /** The error to rethrow: the handler boundary forwards it unchanged. */
  cause: ApiResponseError;
}

export type ContractResult<T> =
  { ok: true; value: T } | { ok: false; error: ContractFailure };

function failure(cause: ApiResponseError): ContractResult<never> {
  const body = cause.body<{ code?: unknown; instance?: unknown }>();
  const envelope = body !== null && typeof body === "object" ? body : {};
  return {
    ok: false,
    error: {
      status: cause.status,
      code: wireErrorCode(envelope.code),
      requestId:
        typeof envelope.instance === "string" ? envelope.instance : undefined,
      cause,
    },
  };
}

/** Checks a payload against a contract decoder. */
export function decodeContract<T>(
  route: string,
  schema: z.ZodType<T>,
  payload: unknown,
): ContractResult<T> {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return { ok: true, value: parsed.data };
  // A decoder only sees a backend success: a write has already happened.
  // `general.unavailable` would offer to send it again and store it twice;
  // this code asks to reload first and offers no retry (#7563).
  const write = !route.startsWith("GET ");
  // Paths and issue codes only: the values are personal data.
  logger.error("contract_decode_failed", {
    route,
    write,
    issues: parsed.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join(".")}: ${issue.code}`),
  });
  return failure(
    bffError(
      502,
      "backend response does not match the contract",
      write ? { code: "general.write_answer_unreadable" } : undefined,
    ),
  );
}

/** GET of a registered route. `route` is its catalog line, for the log. */
export async function contractGet<T>(
  route: string,
  schema: z.ZodType<T>,
  endpoint: string,
  token: string,
  options?: { signal?: AbortSignal },
): Promise<ContractResult<T>> {
  let payload: unknown;
  try {
    payload = options
      ? await apiGet<unknown>(endpoint, token, options)
      : await apiGet<unknown>(endpoint, token);
  } catch (error) {
    if (isApiResponseError(error)) return failure(error);
    throw error;
  }
  return decodeContract(route, schema, payload);
}

/** A generated route entry with a body: `routes["POST /api/students/"]`. */
interface WriteRoute<B, T> {
  method: "POST" | "PUT";
  pattern: string;
  request: RequestBody<B>;
  response: z.ZodType<T>;
}

/**
 * POST or PUT of a registered route. The entry types the body and decodes
 * the answer; `endpoint` is the path with its parameters filled in.
 */
export async function contractWrite<B, T>(
  route: WriteRoute<B, T>,
  endpoint: string,
  token: string,
  body: B,
): Promise<ContractResult<T>> {
  let payload: unknown;
  try {
    payload =
      route.method === "POST"
        ? await apiPost<unknown, B>(endpoint, token, body)
        : await apiPut<unknown, B>(endpoint, token, body);
  } catch (error) {
    if (isApiResponseError(error)) return failure(error);
    throw error;
  }
  return decodeContract(
    `${route.method} ${route.pattern}`,
    route.response,
    payload,
  );
}
