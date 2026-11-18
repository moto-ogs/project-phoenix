// The one proxy of a portal (#2352): it forwards a request only when the
// generated contract lists the route for that portal, and checks the answer
// against the route's decoder (ADR 0270).
import type { NextRequest } from "next/server";
import type { z } from "zod";
import { bffError, handleApiError } from "~/lib/api-response-error.server";
import type { makePortalHandlers } from "~/lib/portal-handlers.server";
import { applyPrivateNoStore } from "~/lib/private-no-store";
import type { RouteContext } from "~/lib/route-wrapper-utils.server";
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
  "get" | "post" | "put" | "patch" | "del" | "api"
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

const startsWith = (path: readonly string[], head: readonly string[]) =>
  head.every((segment, index) => path[index] === segment);

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
 */
export function makeCatalogProxy(
  portal: PortalHandlers,
  mount: string,
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
  outside: readonly string[] = [],
) {
  const prefix = segmentsOf(mount);
  const heads = [prefix, ...outside.map(segmentsOf)];
  const served = routes
    .filter((route) => route.method === method)
    .filter(hasOneDecoder)
    .map((route) => ({ route, pattern: segmentsOf(route.pattern) }))
    .filter(({ pattern }) => heads.some((head) => startsWith(pattern, head)))
    // A literal segment wins over a parameter in the same place.
    .sort(
      (a, b) =>
        a.pattern.filter(isParam).length - b.pattern.filter(isParam).length,
    );
  const outsideHeads = heads.slice(1);

  function lookup(full: string[]) {
    const hit = served.find(({ pattern }) => matches(pattern, full));
    return hit ? { route: hit.route, segments: full } : null;
  }

  function find(path: unknown) {
    const tail = Array.isArray(path) ? (path as unknown[]) : [path];
    if (!tail.every((segment) => typeof segment === "string")) return null;
    const segments = tail as string[];
    const underMount = lookup([...prefix, ...segments]);
    if (underMount) return underMount;
    return outsideHeads.some((head) => startsWith(segments, head))
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
    // A DELETE may answer 204; every other empty answer breaks the contract.
    if (method === "DELETE" && answer === undefined) return null;
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
    DELETE: (options: Options) => portal.del(read, options),
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

  return async (request: NextRequest, context: RouteContext) => {
    const found = find((await context.params)?.path);
    if (!found) {
      const response = handleApiError(notFound(), request);
      applyPrivateNoStore(response.headers);
      return response;
    }
    return handlerOf(found.route)(request, context);
  };
}
