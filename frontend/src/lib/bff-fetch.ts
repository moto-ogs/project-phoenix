// The one browser call for a JSON route of the BFF, in every portal (#7806).
// The route key names the registered Go route; its generated entry types
// the path parameters, the query, the body and the answer. Decisions:
// docs/agents/frontend-api.md#browser-calls.
import type { z } from "zod";
import { ApiError, apiErrorFromResponse, transportFetch } from "./api-error";
import type { portalRoutes } from "./contract/portals.generated";
import type { RequestBody } from "./contract/runtime";
import type { ErrorCode } from "./error-codes.generated";
import { sessionFetch } from "./session-cache";

/** A portal by the scope of its session token (`portalRoutes`). */
export type Portal = Exclude<keyof typeof portalRoutes, "public">;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// A JSON route: its answer is one decoder, or one per variant that a query
// parameter picks (GET /api/students/ and its `view`). File answers are not
// JSON routes of this helper.
type JsonRoute<P extends Portal> = Extract<
  (typeof portalRoutes)[P][number],
  { response: z.ZodType } | { variantParam: string }
>;

type KeyOf<R> = R extends {
  method: infer M extends string;
  pattern: infer T extends string;
}
  ? `${M} ${T}`
  : never;

type FileRoute<P extends Portal> = Extract<
  (typeof portalRoutes)[P][number],
  { response: { kind: "file" } }
>;

/** A registered file route of the portal (`File: true` in Go). */
export type FileRouteKey<P extends Portal> = KeyOf<FileRoute<P>>;

type FileRouteOf<P extends Portal, K extends FileRouteKey<P>> =
  FileRoute<P> extends infer R
    ? R extends unknown
      ? KeyOf<R> extends K
        ? R
        : never
      : never
    : never;

/** A registered JSON route of the portal: `"GET /api/activities/categories"`. */
export type RouteKey<P extends Portal> = KeyOf<JsonRoute<P>>;

type RouteOf<P extends Portal, K extends RouteKey<P>> =
  JsonRoute<P> extends infer R
    ? R extends unknown
      ? KeyOf<R> extends K
        ? R
        : never
      : never
    : never;

type ParamNames<S extends string> =
  S extends `${string}{${infer N}}${infer Rest}` ? N | ParamNames<Rest> : never;

type QueryValue =
  string | number | boolean | null | undefined | readonly (string | number)[];

/** The variant names of a route with response variants. */
type VariantOf<R> = R extends {
  variantParam: string;
  response: infer M;
}
  ? keyof M & string
  : never;

type DefaultVariant<R> = R extends { defaultVariant: infer D extends string }
  ? D
  : never;

type Answer<R, V> = R extends { variantParam: string; response: infer M }
  ? V extends keyof M
    ? M[V] extends z.ZodType<infer O>
      ? O
      : never
    : never
  : R extends { response: z.ZodType<infer O> }
    ? O
    : never;

/**
 * What the call resolves to: the `data` of the answer, a paginated list
 * also its `pagination`; `null` for a route without data and for a 204.
 */
export type BffResult<R, V = never> =
  Answer<R, [V] extends [never] ? DefaultVariant<R> : V> extends {
    data: infer D;
    pagination: infer G;
  }
    ? { data: D; pagination: G }
    : Answer<R, [V] extends [never] ? DefaultVariant<R> : V> extends {
          data: infer D;
        }
      ? D
      : never;

type BodyOf<R> = R extends { request: RequestBody<infer B> }
  ? { body: B }
  : R extends { request: { kind: "multipart" } }
    ? { body: FormData }
    : { body?: never };

type ParamsOf<R> = R extends { pattern: infer T extends string }
  ? [ParamNames<T>] extends [never]
    ? { params?: never }
    : { params: Record<ParamNames<T>, string> }
  : never;

type VariantQuery<R, V> = R extends { variantParam: infer N extends string }
  ? { [key in N]?: V }
  : unknown;

type QueryOf<R, V> = R extends { query: readonly (infer Q extends string)[] }
  ? {
      query?: Partial<
        Record<
          Exclude<Q, R extends { variantParam: infer N } ? N : never>,
          QueryValue
        >
      > &
        VariantQuery<R, V>;
    }
  : { query?: never };

interface CallOptions {
  signal?: AbortSignal;
  headers?: Readonly<Record<string, string>>;
  /**
   * The ApiError's message, e.g. "Kategorie konnte nicht angelegt werden".
   * The user reads the catalog text of the error's code; this text is the
   * fallback a client and its tests already name.
   */
  errorMessage?: string;
  /**
   * Tenant only: a 401 with one of these codes refuses this operation and
   * leaves the session as it is; it becomes an ApiError without a renewal.
   */
  authRefusals?: readonly ErrorCode[];
}

type BffOptions<R, V> = CallOptions & BodyOf<R> & ParamsOf<R> & QueryOf<R, V>;

type OptionalArg<R, V> =
  object extends BffOptions<R, V>
    ? [options?: BffOptions<R, V>]
    : [options: BffOptions<R, V>];

interface PortalRow {
  /** Where the backend mounts the portal's routes. */
  mount: string;
  /** The BFF prefix of the portal's catalog proxy. */
  bff: string;
  /** Sends the request; owns the portal's answer to a 401. */
  send: (
    url: string,
    init: RequestInit,
    options: CallOptions,
  ) => Promise<Response>;
}

const sendPlain = (url: string, init: RequestInit) =>
  transportFetch(url, { ...init, credentials: "include", cache: "no-store" });

function onLoginPage(path: string): boolean {
  return window.location.pathname.startsWith(path);
}

/**
 * Where the portals differ, and nowhere else. A 401 has reached the browser
 * after the BFF renewed the session once:
 * - tenant: the session gate and one renewal with a retry (`sessionFetch`),
 *   then a sign-out;
 * - operator (`platform`) and parents: a switch to the portal's login;
 * - Träger (`org`), moto schule and caterer: the ApiError, as before.
 */
const PORTALS: Readonly<Record<Portal, PortalRow>> = {
  tenant: {
    mount: "/api",
    bff: "/api",
    send: (url, init, { authRefusals }) =>
      authRefusals
        ? sessionFetch(url, init, { authRefusals })
        : sessionFetch(url, init),
  },
  parent: {
    mount: "/parent",
    bff: "/api/parent",
    send: async (url, init) => {
      const response = await sendPlain(url, init);
      if (response.status === 401 && typeof window !== "undefined") {
        window.location.assign("/parents/login");
      }
      return response;
    },
  },
  school: { mount: "/school", bff: "/api/school", send: sendPlain },
  org: { mount: "/traeger", bff: "/api/traeger", send: sendPlain },
  caterer: { mount: "/caterer", bff: "/api/caterer", send: sendPlain },
  platform: {
    mount: "/operator",
    bff: "/api/operator",
    send: async (url, init) => {
      const response = await sendPlain(url, init);
      if (
        response.status === 401 &&
        typeof window !== "undefined" &&
        !onLoginPage("/operator/login")
      ) {
        window.location.href = "/operator/login";
        throw new ApiError("Session expired", 401);
      }
      return response;
    },
  },
};

/** The BFF path of a backend pattern, with its parameters filled in. */
export function bffPath(
  portal: Portal,
  pattern: string,
  params: Readonly<Record<string, string>> = {},
  query?: Readonly<Record<string, QueryValue>>,
): string {
  const { mount, bff } = PORTALS[portal];
  const filled = pattern.replaceAll(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") {
      throw new Error(`bffJson: missing path parameter ${name} of ${pattern}`);
    }
    return encodeURIComponent(value);
  });
  const underMount = filled === mount || filled.startsWith(`${mount}/`);
  const path = (
    bff + (underMount ? filled.slice(mount.length) : filled)
  ).replace(/\/+$/, "");
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, String(item));
    }
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Sends through the portal's row; a failure is the ApiError. */
async function send(
  portal: Portal,
  method: Method,
  url: string,
  init: RequestInit,
  options: CallOptions,
): Promise<Response> {
  const response = await PORTALS[portal].send(url, init, options);
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      options.errorMessage ?? `${method} ${url} failed (${response.status})`,
    );
  }
  return response;
}

async function call<T>(
  portal: Portal,
  method: Method,
  url: string,
  options: CallOptions & { body?: unknown },
): Promise<T> {
  const { body, signal, headers, errorMessage } = options;
  const isForm = body instanceof FormData;
  const json = body !== undefined && !isForm;
  const init: RequestInit = {
    method,
    ...(signal && { signal }),
    ...((json || headers) && {
      headers: json
        ? { "Content-Type": "application/json", ...headers }
        : { ...headers },
    }),
    ...(body !== undefined && { body: isForm ? body : JSON.stringify(body) }),
  };
  const response = await send(portal, method, url, init, options);
  const message = (status: number) =>
    errorMessage ?? `${method} ${url} failed (${status})`;
  if (response.status === 204) return null as T;
  let answer: unknown;
  try {
    answer = await response.json();
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    ) {
      throw error;
    }
    answer = undefined;
  }
  if (answer === null || typeof answer !== "object" || !("data" in answer)) {
    // The proxy decodes every answer, so this is a broken BFF route. A
    // write may have happened: the person reloads before trying again.
    throw new ApiError(message(502), 502, {
      code:
        method === "GET"
          ? "general.unavailable"
          : "general.write_answer_unreadable",
    });
  }
  const { data, pagination } = answer as {
    data: unknown;
    pagination?: unknown;
  };
  return (
    pagination === undefined ? (data ?? null) : { data, pagination }
  ) as T;
}

/**
 * Calls a registered JSON route through the portal's BFF and resolves to the
 * `data` of its answer (a paginated list: `{ data, pagination }`; no data or
 * a 204: `null`). A failure is an ApiError with the backend's code, field
 * errors and request ID; an answer without `data` is a 502.
 *
 * ```ts
 * const rows = await bffJson("tenant", "GET /api/students/{id}/partial-absences", {
 *   params: { id: studentId },
 *   query: { from, to },
 * });
 * ```
 */
export function bffJson<
  P extends Portal,
  K extends RouteKey<P>,
  V extends VariantOf<RouteOf<P, K>> = never,
>(
  portal: P,
  route: K,
  ...[options]: OptionalArg<RouteOf<P, K>, V>
): Promise<BffResult<RouteOf<P, K>, V>> {
  const space = route.indexOf(" ");
  const method = route.slice(0, space) as Method;
  const opts = (options ?? {}) as CallOptions & {
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, QueryValue>;
  };
  const url = bffPath(portal, route.slice(space + 1), opts.params, opts.query);
  return call(portal, method, url, opts);
}

/**
 * Calls a registered file route through the portal's BFF and resolves to the
 * successful Response, whose body the caller reads (`blob()`) together with
 * its `Content-Disposition`. A failure is the same ApiError as in bffJson.
 */
export async function bffFile<P extends Portal, K extends FileRouteKey<P>>(
  portal: P,
  route: K,
  ...[options]: OptionalArg<FileRouteOf<P, K>, never>
): Promise<Response> {
  const space = route.indexOf(" ");
  const method = route.slice(0, space) as Method;
  const opts = (options ?? {}) as CallOptions & {
    params?: Record<string, string>;
    query?: Record<string, QueryValue>;
  };
  const url = bffPath(portal, route.slice(space + 1), opts.params, opts.query);
  return send(
    portal,
    method,
    url,
    { method, ...(opts.signal && { signal: opts.signal }) },
    opts,
  );
}

/**
 * The same call for a BFF path no Go route registers: a named `route.ts`
 * whose behavior belongs to the BFF (`settings/values/[key]` purges the
 * cached tenant lookup). The caller names the answer's type. Every caller is
 * listed with its reason in `bff-fetch-uncontracted.test.ts`, and the list
 * only shrinks; a backend route without a contract gets one instead (#7808).
 */
export function bffJsonUncontracted<T>(
  portal: Portal,
  method: Method,
  path: string,
  options: CallOptions & { body?: unknown } = {},
): Promise<T> {
  return call(portal, method, path, options);
}
