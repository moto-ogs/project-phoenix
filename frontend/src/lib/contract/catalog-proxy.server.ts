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
}

export type CatalogMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type PortalHandlers = Pick<
  ReturnType<typeof makePortalHandlers>,
  "get" | "post" | "put" | "patch" | "delWithBody" | "api"
>;

type Envelope = z.ZodType<{ data: unknown }>;

const segmentsOf = (path: string) => path.split("/").filter(Boolean);

const isParam = (segment: string) =>
  segment.startsWith("{") && segment.endsWith("}");

/** A parameter never stands for an empty or a dot segment. */
const UNSAFE_SEGMENTS = new Set(["", ".", ".."]);

/** No body, or the empty object an empty body parses to. */
const isEmptyBody = (body: unknown) =>
  body === undefined ||
  (typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).length === 0);

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

/**
 * Builds the handler of one method for a portal's catch-all route
 * `app/api/<portal>/[...path]/route.ts`. `mount` is the backend prefix the
 * portal's BFF paths stand for: `/api/parent/x` reaches `/parent/x`.
 *
 * A path the portal's list does not name is answered 404 before the session
 * is read and before any backend call. The backend path is built from the
 * request's segments, each encoded again, and only the registered query
 * parameters travel. Session, the single 401 renewal, body limit and the
 * response envelope are the portal's own handlers.
 */
export function makeCatalogProxy(
  portal: PortalHandlers,
  mount: string,
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
) {
  const served = routes
    .filter((route) => route.method === method)
    .filter(hasOneDecoder)
    .map((route) => ({ route, pattern: segmentsOf(route.pattern) }))
    // A literal segment wins over a parameter in the same place.
    .sort(
      (a, b) =>
        a.pattern.filter(isParam).length - b.pattern.filter(isParam).length,
    );
  const prefix = segmentsOf(mount);

  function find(path: unknown) {
    const tail = Array.isArray(path) ? (path as unknown[]) : [path];
    if (!tail.every((segment) => typeof segment === "string")) return null;
    const full = [...prefix, ...(tail as string[])];
    const hit = served.find(({ pattern }) => matches(pattern, full));
    return hit ? { route: hit.route, segments: full } : null;
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

  // A DELETE may carry a JSON body (a reason, #2352); an empty one travels
  // as no body at all.
  const remove = async (
    request: NextRequest,
    body: unknown,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const { route, endpoint } = target(request, params.path);
    const sent = isEmptyBody(body) ? undefined : body;
    const answer = await portal.api(method, endpoint, token, sent, {
      request,
    });
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

  const handlers = {
    GET: () => portal.get(read),
    DELETE: () => portal.delWithBody(remove),
    POST: () => portal.post(write),
    PUT: () => portal.put(write),
    PATCH: () => portal.patch(write),
  } satisfies Record<CatalogMethod, () => unknown>;
  const handler = handlers[method]();

  return async (request: NextRequest, context: RouteContext) => {
    if (!find((await context.params)?.path)) {
      const response = handleApiError(notFound(), request);
      applyPrivateNoStore(response.headers);
      return response;
    }
    return handler(request, context);
  };
}
