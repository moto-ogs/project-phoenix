// The one browser call for a JSON route of the BFF, in every portal (#7806).
// The route key names the registered Go route; its generated entry types
// the path parameters, the query, the body and the answer. Decisions:
// docs/agents/frontend-api.md#browser-calls.
import type { z } from "zod";
import {
  ApiError,
  apiErrorFromResponse,
  unavailableApiError,
} from "./api-error";
import type {
  portalRoutes,
  routeFileRoutes,
} from "./contract/portals.generated";
import type { RequestBody } from "./contract/runtime";
import type { ErrorCode } from "./error-codes.generated";
import type { SessionBffRoute } from "./session-bff";
import { renewTenantSession, requireTenantSession } from "./session-cache";

/**
 * A portal by the scope of its session token (`portalRoutes`); `public` are
 * the routes without a session (links, password reset, invitations).
 */
export type Portal = keyof typeof portalRoutes;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * The routes of a portal: those its catalog proxy forwards, and those a named
 * `route.ts` serves (`routeFileRoutes`, a cache purge or a flow cookie
 * around the backend's answer).
 */
type AnyRoute<P extends Portal> =
  | (typeof portalRoutes)[P][number]
  | (P extends keyof typeof routeFileRoutes
      ? (typeof routeFileRoutes)[P][number]
      : never);

/**
 * A sign-in, second factor, renewal or switch step: its route file keeps the
 * tokens and answers the BFF's own `{ status, data }` (#7833). The generated
 * answer is the backend's, not the browser's, so these steps are no routes
 * of bffJson under their Go keys; the BFF defines its own browser entries.
 */
const SESSION_STEP =
  "the answer carries or ends the tokens the portal's route file turns into its session cookie";

type RouteFileReason = {
  [
    P in keyof typeof routeFileRoutes
  ]: (typeof routeFileRoutes)[P][number] extends infer R
    ? R extends { routeFile: infer T extends string }
      ? T
      : never
    : never;
}[keyof typeof routeFileRoutes];

// Fails to compile once the generator words the reason differently, so the
// session steps never slip into bffJson with the backend's answer type.
const sessionStepAnchor: RouteFileReason = SESSION_STEP;
void sessionStepAnchor;

// A JSON route: its answer is one decoder, or one per variant that a query
// parameter picks (GET /api/students/ and its `view`). File answers, the
// session steps and answers without the envelope (`plain`) are not JSON
// routes of this helper.
type JsonRoute<P extends Portal> = Exclude<
  Extract<AnyRoute<P>, { response: z.ZodType } | { variantParam: string }>,
  { routeFile: typeof SESSION_STEP } | { plain: true }
>;

type KeyOf<R> = R extends {
  method: infer M extends string;
  pattern: infer T extends string;
}
  ? `${M} ${T}`
  : never;

type FileRoute<P extends Portal> = Extract<
  AnyRoute<P>,
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
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

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

type QueryScalar = {
  string: string;
  id: string;
  // A YYYY-MM-DD string on the wire. Go validates the calendar date.
  date: string;
  int: number;
  bool: boolean;
};

type ScalarOf<Q> = Q extends { values: readonly (infer Value extends string)[] }
  ? Value
  : Q extends { kind: infer Kind extends keyof QueryScalar }
    ? QueryScalar[Kind]
    : never;

type QueryOf<R, V> = R extends { query: infer Q }
  ? {
      query?: {
        -readonly [
          K in keyof Q as R extends { variantParam: K } ? never : K
        ]?: Q[K] extends { repeated: true }
          ? readonly ScalarOf<Q[K]>[]
          : ScalarOf<Q[K]>;
      } & VariantQuery<R, V>;
    }
  : { query?: never };

/** The query accepted by a generated route entry. */
export type BffQuery<R> = NonNullable<QueryOf<R, VariantOf<R>>["query"]>;

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
   * Tenant, parent and operator: a 401 with one of these codes refuses this
   * operation and leaves the session as it is, without renewal or a login
   * redirect.
   */
  authRefusals?: readonly ErrorCode[];
  /**
   * Lets the request outlive the page (`fetch` keepalive): a cleanup sent
   * from `pagehide`, such as deleting a draft's upload. Starts immediately
   * without a browser session lookup or renewal; the BFF authenticates it.
   */
  keepalive?: boolean;
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

/**
 * The one `fetch` of the helper. A request that never reached the BFF
 * (offline, DNS) becomes `general.unavailable` instead of a raw TypeError
 * like "Failed to fetch"; a cancellation stays an AbortError, because
 * callers use AbortSignal to supersede stale work.
 */
async function transport(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw unavailableApiError(error);
  }
}

function isAbort(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/** Whether a 401 is one of the call's operation-specific refusals. */
async function isAuthRefusal(
  response: Response,
  authRefusals: readonly ErrorCode[] | undefined,
): Promise<boolean> {
  if (!authRefusals?.length) return false;
  const refusal = await apiErrorFromResponse(
    response.clone(),
    "Request refused",
  );
  return refusal.code !== undefined && authRefusals.includes(refusal.code);
}

const sendPlain = (url: string, init: RequestInit) =>
  transport(url, { ...init, credentials: "include", cache: "no-store" });

/**
 * Staff: the session gate before the request, then on a 401 one renewal and
 * one retry. Keepalive cleanup goes out immediately: a session lookup or
 * renewal cannot outlive an unloading page; the BFF still authenticates it.
 * An operation-specific refusal (`authRefusals`) leaves the session as it is
 * and reaches the caller as its ApiError.
 */
async function sendTenant(
  url: string,
  init: RequestInit,
  { authRefusals }: CallOptions,
): Promise<Response> {
  if (init.keepalive) return transport(url, init);
  await requireTenantSession();
  const response = await transport(url, init);
  if (response.status !== 401) return response;
  if (await isAuthRefusal(response, authRefusals)) return response;
  await renewTenantSession();
  return transport(url, init);
}

function onLoginPage(path: string): boolean {
  return window.location.pathname.startsWith(path);
}

/**
 * Where the portals differ, and nowhere else. A 401 has reached the browser
 * after the BFF renewed the session once:
 * - tenant: the session gate and one renewal with a retry (`sendTenant`),
 *   then a sign-out;
 * - operator (`platform`) and parents: a switch to the portal's login
 *   (operation-specific `authRefusals` stay on the page);
 * - Träger (`org`), moto schule and caterer: the ApiError, as before.
 */
const PORTALS: Readonly<Record<Portal, PortalRow>> = {
  tenant: { mount: "/api", bff: "/api", send: sendTenant },
  parent: {
    mount: "/parent",
    bff: "/api/parent",
    send: async (url, init, { authRefusals }) => {
      const response = await sendPlain(url, init);
      if (response.status === 401 && typeof window !== "undefined") {
        if (await isAuthRefusal(response, authRefusals)) return response;
        window.location.assign("/parents/login");
      }
      return response;
    },
  },
  school: { mount: "/school", bff: "/api/school", send: sendPlain },
  org: { mount: "/traeger", bff: "/api/traeger", send: sendPlain },
  caterer: { mount: "/caterer", bff: "/api/caterer", send: sendPlain },
  // Without a session: no gate, no renewal, the error stays on the page.
  // Its patterns name their portal themselves (`/caterer/invitations/…`).
  public: { mount: "", bff: "/api", send: sendPlain },
  platform: {
    mount: "/operator",
    bff: "/api/operator",
    send: async (url, init, { authRefusals }) => {
      const response = await sendPlain(url, init);
      if (
        response.status === 401 &&
        typeof window !== "undefined" &&
        !onLoginPage("/operator/login") &&
        !(await isAuthRefusal(response, authRefusals))
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
  const underMount =
    mount !== "" && (filled === mount || filled.startsWith(`${mount}/`));
  // A public pattern under /api (enrollment links) is its BFF path already.
  const atBff = mount === "" && filled.startsWith(`${bff}/`);
  const path = (
    atBff ? filled : bff + (underMount ? filled.slice(mount.length) : filled)
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

/** The fetch init of a call: JSON serialized, FormData as is. */
function requestInit(
  method: Method,
  { body, signal, headers, keepalive }: CallOptions & { body?: unknown },
): RequestInit {
  const isForm = body instanceof FormData;
  const json = body !== undefined && !isForm;
  return {
    method,
    ...(signal && { signal }),
    ...(keepalive && { keepalive }),
    ...((json || headers) && {
      headers: json
        ? { "Content-Type": "application/json", ...headers }
        : { ...headers },
    }),
    ...(body !== undefined && { body: isForm ? body : JSON.stringify(body) }),
  };
}

async function call<T>(
  portal: Portal,
  method: Method,
  url: string,
  options: CallOptions & { body?: unknown },
): Promise<T> {
  const { errorMessage } = options;
  const init = requestInit(method, options);
  const response = await send(portal, method, url, init, options);
  const message = (status: number) =>
    errorMessage ?? `${method} ${url} failed (${status})`;
  if (response.status === 204) return null as T;
  let answer: unknown;
  try {
    answer = await response.json();
  } catch (error) {
    if (isAbort(error)) throw error;
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
export function bffJson<T>(
  portal: Portal,
  route: SessionBffRoute<T>,
  options?: CallOptions & { body?: unknown },
): Promise<T>;
export function bffJson<
  P extends Portal,
  K extends RouteKey<P>,
  V extends VariantOf<RouteOf<P, K>> = never,
>(
  portal: P,
  route: K,
  ...[options]: OptionalArg<RouteOf<P, K>, V>
): Promise<BffResult<RouteOf<P, K>, V>>;
export function bffJson(
  portal: Portal,
  route: string | SessionBffRoute<unknown>,
  options?: CallOptions,
): Promise<unknown> {
  const space = typeof route === "string" ? route.indexOf(" ") : -1;
  const opts = (options ?? {}) as CallOptions & {
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, QueryValue>;
  };
  if (typeof route !== "string")
    return call(portal, route.method, route.path, opts);
  const method = route.slice(0, space) as Method;
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
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, QueryValue>;
  };
  const url = bffPath(portal, route.slice(space + 1), opts.params, opts.query);
  return send(portal, method, url, requestInit(method, opts), opts);
}

/**
 * The same call for the remaining BFF paths without a shared browser
 * entry. The caller names the answer's type. Every caller is
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
