// Reads a registered route and checks the answer against its generated
// decoder (ADR 0270). A backend error and an answer that does not match the
// contract both come back as a typed failure, never as an empty value.
import type { z } from "zod";
import {
  readBackendJson,
  sendBackend,
  type BackendCall,
  type BackendMethod,
} from "~/lib/backend-client.server";
import { wireErrorCode } from "~/lib/api-error";
import {
  ApiResponseError,
  bffError,
  isApiResponseError,
} from "~/lib/api-response-error.server";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { createLogger } from "~/lib/logger";
import {
  fillRoutePath,
  routeSearch,
  type ParamsOf,
  type QueryOf,
  type QueryValue,
} from "./address";
import type { RequestBody } from "./runtime";

const logger = createLogger({ component: "Contract" });

interface ContractFailure {
  status: number;
  /** The registry code of the RFC 9457 body, when the backend sent one. */
  code: ErrorCode | undefined;
  /** The request ID the backend named in `instance`. */
  requestId: string | undefined;
  /** Rethrow this at the handler boundary to preserve the status and apply its error policy. */
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

/**
 * Whether a request may have committed a change its caller asked for: every
 * method but GET, unless the contract names why a POST commits nothing
 * (`noCommit`, a preview or a search). An unreadable answer of such a request
 * asks to reload instead of offering a resend (#7563).
 */
export function commits(route: {
  readonly method: string;
  readonly noCommit?: string;
}): boolean {
  return route.method !== "GET" && route.noCommit === undefined;
}

/**
 * Checks a payload against a contract decoder. `route` is the catalog line
 * for the log, `write` what {@link commits} says of it.
 */
export function decodeContract<T>(
  route: string,
  schema: z.ZodType<T>,
  payload: unknown,
  write: boolean,
): ContractResult<T> {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return { ok: true, value: parsed.data };
  // Paths and issue codes only: the values are personal data.
  logger.error("contract_decode_failed", {
    route,
    write,
    issues: parsed.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join(".")}: ${issue.code}`),
  });
  return failure(invalidAnswer(write));
}

function invalidAnswer(write: boolean): ApiResponseError {
  return bffError(
    502,
    "backend response does not match the contract",
    write ? { code: "general.write_answer_unreadable" } : undefined,
  );
}

/** Reads a JSON answer without losing the distinction between refusal and a
 * successful write whose answer was lost. Never log the raw parse error. */
export async function readContractJson(
  response: Response,
  route: { pattern: string; method: string; noCommit?: string },
  options?: Pick<BackendCall, "signal" | "request">,
): Promise<unknown> {
  try {
    return await readBackendJson<unknown>(response);
  } catch (error) {
    const write = commits(route);
    // A browser disconnect does not undo an upstream commit.
    const aborted =
      options?.signal?.aborted || options?.request?.signal.aborted;
    if (!response.ok || (aborted && !write)) throw error;
    if (!aborted) {
      logger.error("contract_json_failed", { route: route.pattern, write });
    }
    throw invalidAnswer(write);
  }
}

interface JsonRoute {
  readonly method: BackendMethod;
  readonly pattern: string;
  readonly noCommit?: string;
  readonly response: z.ZodType;
}

interface VariantRoute extends Omit<JsonRoute, "response"> {
  readonly variantParam: string;
  readonly defaultVariant: string;
  readonly response: Readonly<Record<string, z.ZodType>>;
}

type VariantOf<R> = R extends VariantRoute
  ? keyof R["response"] & string
  : never;
type ReadAnswer<R, V> = R extends VariantRoute
  ? z.output<
      R["response"][[V] extends [never] ? R["defaultVariant"] : V & string]
    >
  : R extends JsonRoute
    ? z.output<R["response"]>
    : never;

export type ContractBody<R> = R extends { request: RequestBody<infer B> }
  ? B
  : R extends { request: { kind: "multipart" } }
    ? FormData
    : undefined;

interface TransportOptions extends Pick<
  BackendCall,
  "request" | "signal" | "timeout" | "headers" | "idempotencyKey"
> {
  /** A bearer the caller holds; omit it for a pre-session or public call. */
  token?: string | null;
  /** Use the portal's session client when the route owns renewal policy. */
  send?: (path: string, call: BackendCall) => Promise<Response>;
}

type ContractAddress<R, V> = ParamsOf<R> & QueryOf<R, V>;
type CallAddress = {
  params?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, QueryValue>>;
};
export type ContractOptions<R, V = never> =
  object extends ContractAddress<R, V>
    ? [options?: TransportOptions & ContractAddress<R, V>]
    : [options: TransportOptions & ContractAddress<R, V>];

export type ContractReply<T> = ContractResult<T> & {
  /** The HTTP result even when the answer body cannot be decoded. */
  backend?: Pick<Response, "headers" | "status" | "ok">;
};

async function callContract<T>(
  route: JsonRoute & { response: z.ZodType<T> },
  options: TransportOptions & CallAddress,
  body?: unknown,
): Promise<ContractReply<T>> {
  const { params, query, token, send, ...transport } = options;
  const endpoint = fillRoutePath(route.pattern, params) + routeSearch(query);
  const call: BackendCall = {
    ...transport,
    method: route.method,
    ...(body instanceof FormData ? { body } : { json: body }),
  };
  let backend: ContractReply<T>["backend"];
  try {
    const response = await (
      send ?? ((path, call) => sendBackend(path, token, call))
    )(endpoint, call);
    backend = {
      headers: response.headers,
      status: response.status,
      ok: response.ok,
    };
    const write = commits(route);
    const payload = await readContractJson(response, route, options);
    return {
      ...decodeContract(
        `${route.method} ${route.pattern}`,
        route.response,
        payload,
        write,
      ),
      backend,
    };
  } catch (error) {
    if (isApiResponseError(error)) return { ...failure(error), backend };
    throw error;
  }
}

/** GET of a registered JSON route, with or without a session. */
export function contractGet<
  const R extends (JsonRoute | VariantRoute) & { method: "GET" },
  V extends VariantOf<R> = never,
>(
  route: R,
  ...[options]: ContractOptions<NoInfer<R>, V>
): Promise<ContractReply<ReadAnswer<R, V>>> {
  const address: TransportOptions & CallAddress = options ?? {};
  let decoded: JsonRoute;
  if ("variantParam" in route) {
    const search = new URLSearchParams(routeSearch(address.query));
    const asked = search.get(route.variantParam);
    const selected =
      asked !== null && Object.hasOwn(route.response, asked)
        ? asked
        : route.defaultVariant;
    const response = route.response[selected];
    if (!response) throw new Error(`missing decoder for ${route.pattern}`);
    decoded = { ...route, response };
  } else {
    decoded = route;
  }
  return callContract(decoded, address) as Promise<
    ContractReply<ReadAnswer<R, V>>
  >;
}

/** Write a registered route once; its generated entry types both directions. */
export function contractWrite<
  const R extends JsonRoute & { method: Exclude<BackendMethod, "GET"> },
>(
  route: R,
  body: NoInfer<ContractBody<R>>,
  ...[options]: ContractOptions<NoInfer<R>>
): Promise<ContractReply<z.output<R["response"]>>> {
  // The output is inferred from this entry's decoder, never from the body.
  return callContract(route, options ?? {}, body) as Promise<
    ContractReply<z.output<R["response"]>>
  >;
}
