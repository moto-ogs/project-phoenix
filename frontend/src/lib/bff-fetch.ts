// The one browser call for a JSON route of the BFF, in every portal (#7806).
// The route key names the registered Go route; its generated entry types
// the path parameters, the query, the body and the answer. Decisions:
// docs/agents/frontend-api.md#browser-calls.
import type { z } from "zod";
import {
  browserRoutePaths,
  noCommitRoutes,
  tenantNoRetryRoutes,
} from "./contract/browser-traits.generated";
import { commits } from "./contract/commit";
import { reloadForNewDeployment } from "./deployment-reload";
import { DEPLOYMENT_ID_HEADER, deploymentId } from "./deployment-skew";
import {
  ApiError,
  apiErrorFromResponse,
  unavailableApiError,
} from "./api-error";
import type {
  portalRoutes,
  routeFileRoutes,
} from "./contract/portals.generated";
import {
  fillRoutePath,
  routeSearch,
  type ParamsOf,
  type QueryOf,
  type QueryValue,
} from "./contract/address";
import type { RequestBody } from "./contract/runtime";
import type { ErrorCode } from "./error-codes.generated";
import type { SessionBffRoute } from "./session-bff-route";
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
      ? Extract<(typeof routeFileRoutes)[P][number], { browserPath: string }>
      : never);

// A JSON route: its answer is one decoder, or one per variant that a query
// parameter picks (GET /api/students/ and its `view`). File answers, the
// session steps and answers without the envelope (`plain`) are not JSON
// routes of this helper.
type JsonRoute<P extends Portal> = Exclude<
  Extract<AnyRoute<P>, { response: z.ZodType } | { variantParam: string }>,
  { browserOwnContract: true } | { plain: true }
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
type RouteKey<P extends Portal> = KeyOf<JsonRoute<P>>;

type RouteOf<P extends Portal, K extends RouteKey<P>> =
  JsonRoute<P> extends infer R
    ? R extends unknown
      ? KeyOf<R> extends K
        ? R
        : never
      : never
    : never;

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
type BffResult<R, V = never> =
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
  /** During logout, send credentials but skip browser session handling. */
  skipAuthRecovery?: boolean;
}

type SendOptions = CallOptions & { noRetryAfterRenewal?: boolean };

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
    options: SendOptions,
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
  { authRefusals, noRetryAfterRenewal }: SendOptions,
): Promise<Response> {
  if (init.keepalive) return transport(url, init);
  await requireTenantSession();
  const response = await transport(url, init);
  if (
    response.status !== 401 ||
    noRetryAfterRenewal ||
    init.body instanceof FormData
  )
    return response;
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
function browserPath(
  portal: Portal,
  pattern: string,
  params: Readonly<Record<string, string>> = {},
  query?: Readonly<Record<string, QueryValue>>,
  key?: string,
): `/api/${string}` {
  const explicit = key && browserRoutePathsForPortal(portal)?.[key];
  if (explicit)
    return `${fillRoutePath(explicit, params)}${routeSearch(query)}` as `/api/${string}`;
  const { mount, bff } = PORTALS[portal];
  const filled = fillRoutePath(pattern, params);
  const underMount =
    mount !== "" && (filled === mount || filled.startsWith(`${mount}/`));
  // A public pattern under /api (enrollment links) is its BFF path already.
  const atBff = mount === "" && filled.startsWith(`${bff}/`);
  const path = (
    atBff ? filled : bff + (underMount ? filled.slice(mount.length) : filled)
  ).replace(/\/+$/, "");
  return `${path}${routeSearch(query)}` as `/api/${string}`;
}

function browserRoutePathsForPortal(
  portal: Portal,
): Readonly<Record<string, string>> | undefined {
  return (
    browserRoutePaths as Partial<
      Record<Portal, Readonly<Record<string, string>>>
    >
  )[portal];
}

type AddressRoute<P extends Portal, K extends KeyOf<AnyRoute<P>>> =
  AnyRoute<P> extends infer R
    ? R extends unknown
      ? KeyOf<R> extends K
        ? R
        : never
      : never
    : never;

/** Same-origin address for a registered route, including named route files. */
export function bffPath<P extends Portal, K extends KeyOf<AnyRoute<P>>>(
  portal: P,
  route: K,
  ...[options]: object extends PathOptions<AddressRoute<P, K>>
    ? [options?: PathOptions<AddressRoute<P, K>>]
    : [options: PathOptions<AddressRoute<P, K>>]
): `/api/${string}` {
  const opts = options as
    | {
        params?: Record<string, string>;
        query?: Record<string, QueryValue>;
      }
    | undefined;
  return browserPath(
    portal,
    route.slice(route.indexOf(" ") + 1),
    opts?.params,
    opts?.query,
    route,
  );
}

type BrowserPattern<R> = R extends { browserPath: infer P extends string }
  ? { pattern: P }
  : R;
type PathOptions<R> = ParamsOf<BrowserPattern<R>> & QueryOf<R, VariantOf<R>>;

/** Sends through the portal's row; a failure is the ApiError. */
async function send(
  portal: Portal,
  method: Method,
  url: string,
  init: RequestInit,
  options: SendOptions,
): Promise<Response> {
  const response = options.skipAuthRecovery
    ? await sendPlain(url, init)
    : await PORTALS[portal].send(url, init, options);
  // The proxy refused a call of a tab older than the server; for a read that
  // loses nothing, the tab reloads and the call never settles
  // (deployment-reload.ts).
  if (reloadForNewDeployment(response, method === "GET")) {
    return new Promise<never>(() => {});
  }
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      options.errorMessage ?? `${method} ${url} failed (${response.status})`,
    );
  }
  return response;
}

/**
 * The fetch init of a call: JSON serialized, FormData as is, and the
 * deployment of this bundle, so a tab older than the server is refused
 * before the route runs (`deployment-skew.ts`).
 */
function requestInit(
  method: Method,
  { body, signal, headers, keepalive }: CallOptions & { body?: unknown },
): RequestInit {
  const isForm = body instanceof FormData;
  const json = body !== undefined && !isForm;
  const deployment = deploymentId();
  return {
    method,
    ...(signal && { signal }),
    ...(keepalive && { keepalive }),
    ...((json || headers || deployment) && {
      headers: {
        ...(json && { "Content-Type": "application/json" }),
        ...(deployment && { [DEPLOYMENT_ID_HEADER]: deployment }),
        ...headers,
      },
    }),
    ...(body !== undefined && { body: isForm ? body : JSON.stringify(body) }),
  };
}

async function call<T>(
  portal: Portal,
  method: Method,
  url: string,
  options: SendOptions & { body?: unknown },
  noCommit?: string,
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
      code: commits({ method, noCommit })
        ? "general.write_answer_unreadable"
        : "general.unavailable",
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
  route: SessionBffRoute<T, undefined>,
  options?: CallOptions & { body?: undefined },
): Promise<T>;
export function bffJson<T, B>(
  portal: Portal,
  route: SessionBffRoute<T, B>,
  options: CallOptions & { body: NoInfer<B> },
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
  route: string | SessionBffRoute<unknown, unknown>,
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
  const url = browserPath(
    portal,
    route.slice(space + 1),
    opts.params,
    opts.query,
    route,
  );
  return call(
    portal,
    method,
    url,
    {
      ...opts,
      noRetryAfterRenewal:
        portal === "tenant" && tenantNoRetryRoutes.has(route),
    },
    noCommitRoutes.has(route) ? route : undefined,
  );
}

type FileHrefOptions<R> = ParamsOf<R> & QueryOf<R, never>;

/** Same-origin address for a registered GET file route (link, image or navigation). */
export function bffFileHref<
  P extends Portal,
  K extends Extract<FileRouteKey<P>, `GET ${string}`>,
>(
  portal: P,
  route: K,
  ...[options]: object extends FileHrefOptions<FileRouteOf<P, K>>
    ? [options?: FileHrefOptions<FileRouteOf<P, K>>]
    : [options: FileHrefOptions<FileRouteOf<P, K>>]
): string {
  const opts = options as
    | {
        params?: Record<string, string>;
        query?: Record<string, QueryValue>;
      }
    | undefined;
  return browserPath(portal, route.slice(4), opts?.params, opts?.query, route);
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
  const url = browserPath(
    portal,
    route.slice(space + 1),
    opts.params,
    opts.query,
    route,
  );
  return send(portal, method, url, requestInit(method, opts), {
    ...opts,
    noRetryAfterRenewal: portal === "tenant" && tenantNoRetryRoutes.has(route),
  });
}

/**
 * The same call for the remaining BFF paths without a shared browser
 * entry. The caller names the answer's type. The shrink-only exception list
 * and reasons are in the `bff-boundary/only-listed-uncontracted` rule.
 * Give a backend route without a contract one instead (#7808).
 */
export function bffJsonUncontracted<T>(
  portal: Portal,
  method: Method,
  path: string,
  options: CallOptions & { body?: unknown } = {},
): Promise<T> {
  return call(portal, method, path, options);
}
