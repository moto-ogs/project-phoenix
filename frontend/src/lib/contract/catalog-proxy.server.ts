// The one proxy of a portal (#2352): it forwards a request only when the
// generated contract lists the route for that portal, and checks the answer
// against the route's decoder (ADR 0270).
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { bffError, handleApiError } from "~/lib/api-response-error.server";
import { readBackendJson, sendBackend } from "~/lib/backend-client.server";
import type { makePortalHandlers } from "~/lib/portal-handlers.server";
import { applyPrivateNoStore } from "~/lib/private-no-store";
import {
  parseRequestBody,
  wrapInApiResponse,
  type RouteContext,
} from "~/lib/route-wrapper-utils.server";
import { underOutsideHead } from "./catalog-outside-mounts";
import { decodeContract } from "./client.server";

/** A generated route entry, as `portalRoutes` lists it. */
export interface CatalogRoute {
  readonly method: string;
  readonly pattern: string;
  /** The query parameters the handler reads; nothing else is forwarded. */
  readonly query?: readonly string[];
  /** A decoder, or the decoders of a legacy route with response variants. */
  readonly response: unknown;
  /** Why the request runs only once, also after a session renewal. */
  readonly noRetryAfterRenewal?: string;
  /** The largest request body read; a larger one is answered 413. */
  readonly maxBodyBytes?: number;
}

export type CatalogMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type PortalHandlers = Pick<
  ReturnType<typeof makePortalHandlers>,
  "get" | "post" | "put" | "patch" | "del" | "delWithBody" | "api"
>;

type Envelope = z.ZodType<{ data: unknown }>;

const segmentsOf = (path: string) => path.split("/").filter(Boolean);

const isParam = (segment: string) =>
  segment.startsWith("{") && segment.endsWith("}");

/** A parameter never stands for an empty or a dot segment. */
const UNSAFE_SEGMENTS = new Set(["", ".", ".."]);

/** A route this proxy can serve: one decoder for its one response shape. */
function hasOneDecoder(
  route: CatalogRoute,
): route is CatalogRoute & { response: Envelope } {
  const response = route.response as { safeParse?: unknown } | null;
  return typeof response?.safeParse === "function";
}

function matches(pattern: readonly string[], path: readonly string[]) {
  return (
    pattern.length === path.length &&
    pattern.every(
      (segment, index) =>
        segment !== "*" &&
        (isParam(segment)
          ? !UNSAFE_SEGMENTS.has(path[index] ?? "")
          : segment === path[index]),
    )
  );
}

/** Compare path segments lexicographically, with parameters after literals. */
function literalFirst(a: readonly string[], b: readonly string[]) {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const left = a[index] ?? "";
    const right = b[index] ?? "";
    const order = Number(isParam(left)) - Number(isParam(right));
    if (order !== 0) return order;
    if (!isParam(left) && left !== right) return left < right ? -1 : 1;
  }
  return a.length - b.length;
}

/** The routes a request reaches without a session (#2352). */
export interface PublicCatalog {
  /** `portalRoutes.public`; the proxy serves those under its mount. */
  readonly routes: readonly CatalogRoute[];
  /** Backend prefixes beside the mount that public routes reach. */
  readonly outside?: readonly string[];
}

/**
 * Builds the handler of one method for a portal's catch-all route
 * `app/api/<portal>/[...path]/route.ts`. `mount` is the backend prefix the
 * portal's BFF paths stand for: `/api/parent/x` reaches `/parent/x`.
 * `outside` names backend prefixes the root mounts beside the portal's mount;
 * a BFF path that starts with one of them reaches it without the mount:
 * `/api/parent/analytics-policy` reaches `/analytics-policy`.
 *
 * A path the portal's list does not name is answered 404 before the session
 * is read and before any backend call. The backend path is built from the
 * request's segments, each encoded again, and only the registered query
 * parameters travel. Session, the single 401 renewal and the response
 * envelope are the portal's own handlers; a route's contract can switch the
 * renewal's retry off and bound the body.
 *
 * `publics` names the routes of the pseudo-portal `public` (#2352). They run
 * on a path of their own that never reads the session and sends no bearer:
 * a link or a public form must not act as whoever is signed in on the
 * device. Their write bodies are bounded by the contract, and every answer
 * is private and uncached, because a link's answer is personal data.
 */
export function makeCatalogProxy(
  portal: PortalHandlers,
  mount: string,
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  outside: readonly string[] = [],
  publics: PublicCatalog = { routes: [] },
) {
  const prefix = segmentsOf(mount);
  const mountHead = mount.replace(/\/$/, "");
  const publicOutside = publics.outside ?? [];
  const entries = (
    list: readonly CatalogRoute[],
    under: readonly string[],
    isPublic: boolean,
  ) =>
    list
      .filter((route) => route.method === method)
      .filter(hasOneDecoder)
      .map((route) => ({ route, pattern: segmentsOf(route.pattern), isPublic }))
      .filter(({ pattern }) =>
        under.some((head) => underOutsideHead(pattern, head)),
      );
  // One table for both lists: a literal segment wins over a parameter in the
  // same place, whichever list the route comes from.
  const served = [
    ...entries(routes, [mountHead, ...outside], false),
    ...entries(publics.routes, [mountHead, ...publicOutside], true),
  ].sort((a, b) => literalFirst(a.pattern, b.pattern));
  const besideMount = [...outside, ...publicOutside];

  function lookup(full: string[]) {
    const hit = served.find(({ pattern }) => matches(pattern, full));
    return hit
      ? { route: hit.route, segments: full, isPublic: hit.isPublic }
      : null;
  }

  function find(path: unknown) {
    const tail = Array.isArray(path) ? (path as unknown[]) : [path];
    if (!tail.every((segment) => typeof segment === "string")) return null;
    const segments = tail as string[];
    const underMount = lookup([...prefix, ...segments]);
    if (underMount) return underMount;
    return besideMount.some((head) => underOutsideHead(segments, head))
      ? lookup(segments)
      : null;
  }

  const notFound = () => bffError(404, "route not found");

  function target(request: NextRequest, path: unknown) {
    const found = find(path);
    if (!found) throw notFound();
    const query = new URLSearchParams();
    for (const name of found.route.query ?? []) {
      for (const value of request.nextUrl.searchParams.getAll(name)) {
        query.append(name, value);
      }
    }
    const search = query.size > 0 ? `?${query.toString()}` : "";
    const endpoint = `/${found.segments.map(encodeURIComponent).join("/")}`;
    return { route: found.route, endpoint: `${endpoint}${search}` };
  }

  function decoded(
    route: CatalogRoute & { response: Envelope },
    answer: unknown,
  ) {
    const result = decodeContract(
      `${route.method} ${route.pattern}`,
      route.response,
      answer,
    );
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  }

  const read = async (
    request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const { route, endpoint } = target(request, params.path);
    const answer = await portal.api(method, endpoint, token, undefined, {
      request,
    });
    return decoded(route, answer);
  };

  /** A DELETE forwards a JSON body, such as a reason, when it carries one. */
  const remove = async (
    request: NextRequest,
    body: unknown,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const { route, endpoint } = target(request, params.path);
    const sent =
      typeof body === "object" && body !== null && Object.keys(body).length > 0;
    const answer = await portal.api(
      method,
      endpoint,
      token,
      sent ? body : undefined,
      { request },
    );
    // A DELETE may answer 204; every other empty answer breaks the contract.
    if (answer === undefined) return null;
    return decoded(route, answer);
  };

  const write = async (
    request: NextRequest,
    body: unknown,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const { route, endpoint } = target(request, params.path);
    const answer = await portal.api(method, endpoint, token, body, {
      idempotencyKey: request.headers.get("Idempotency-Key"),
      request,
    });
    return decoded(route, answer);
  };

  type Options = {
    retry?: { off: string };
    maxBodyBytes?: number;
  };
  const factories = {
    GET: (options: Options) => portal.get(read, options),
    DELETE: (options: Options) => portal.delWithBody(remove, options),
    POST: (options: Options) => portal.post(write, options),
    PUT: (options: Options) => portal.put(write, options),
    PATCH: (options: Options) => portal.patch(write, options),
  } satisfies Record<CatalogMethod, (options: Options) => unknown>;

  // One handler per route: its contract decides the renewal's retry and the
  // body limit before the body is read.
  const handlers = new Map<CatalogRoute, ReturnType<typeof factories.GET>>();
  function handlerOf(route: CatalogRoute) {
    let handler = handlers.get(route);
    if (!handler) {
      handler = factories[method]({
        ...(route.noRetryAfterRenewal
          ? { retry: { off: route.noRetryAfterRenewal } }
          : {}),
        ...(route.maxBodyBytes ? { maxBodyBytes: route.maxBodyBytes } : {}),
      });
      handlers.set(route, handler);
    }
    return handler;
  }

  /**
   * A public route: no session read, no bearer, no renewal. The body is
   * read within the route's limit; a write without one reads nothing.
   */
  async function servePublic(
    request: NextRequest,
    route: CatalogRoute & { response: Envelope },
    context: RouteContext,
  ): Promise<Response> {
    const { endpoint } = target(request, (await context.params)?.path);
    const json =
      method === "GET"
        ? undefined
        : await parseRequestBody(request, route.maxBodyBytes ?? 0);
    const answer = await readBackendJson<unknown>(
      await sendBackend(endpoint, null, {
        method,
        json,
        idempotencyKey: request.headers.get("Idempotency-Key"),
        request,
      }),
    );
    return NextResponse.json(wrapInApiResponse(decoded(route, answer)));
  }

  return async (request: NextRequest, context: RouteContext) => {
    const found = find((await context.params)?.path);
    if (!found?.isPublic) {
      if (found) return handlerOf(found.route)(request, context);
      const response = handleApiError(notFound(), request);
      applyPrivateNoStore(response.headers);
      return response;
    }
    let response: Response;
    try {
      response = await servePublic(
        request,
        found.route as CatalogRoute & { response: Envelope },
        context,
      );
    } catch (error) {
      response = handleApiError(error, request);
    }
    applyPrivateNoStore(response.headers);
    return response;
  };
}

/**
 * The head of a route file below a portal's BFF prefix that Next would give
 * another file (Auth.js's `auth/[...nextauth]`, or a sibling with a dynamic
 * segment): literal segments, and for a dynamic folder above the file a
 * function of the route's params.
 */
export type HandOffHead =
  | readonly string[]
  | ((
      params: Record<string, string | string[] | undefined>,
    ) => readonly string[] | null);

/**
 * Hands a request to a portal's catalog proxy with the path its catch-all
 * would receive: the file's own catch-all `path`, the tail after the head,
 * gets the head in front again. A head the params cannot name is answered
 * by the proxy's 404, as an unknown path is.
 */
export function handOffUnder(
  head: HandOffHead,
  handler: (request: NextRequest, context: RouteContext) => Promise<Response>,
) {
  return (request: NextRequest, context: RouteContext) =>
    handler(request, {
      params: context.params.then((params) => {
        const tail = params.path;
        const rest = Array.isArray(tail) ? tail : tail ? [tail] : [];
        const lead = typeof head === "function" ? head(params) : head;
        // An empty segment matches no route: the proxy answers 404.
        return { ...params, path: lead ? [...lead, ...rest] : [""] };
      }),
    });
}
