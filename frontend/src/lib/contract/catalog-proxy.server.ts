// The one proxy of a portal (#2352): it forwards a request only when the
// generated contract lists the route for that portal, and checks the answer
// against the route's decoder (ADR 0270). A file answer and a multipart
// upload stream through it unread (ADR 0270, addendum of 2026-11-19); a
// public file only where its contract marks it (addendum "Öffentliche
// Datei-Routen").
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { bffError, handleApiError } from "~/lib/api-response-error.server";
import { readBackendJson, sendBackend } from "~/lib/backend-client.server";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { fileResponse } from "~/lib/file-response.server";
import type { makePortalHandlers } from "~/lib/portal-handlers.server";
import { applyPrivateNoStore } from "~/lib/private-no-store";
import type { ApiResponse, PaginatedApiResponse } from "~/lib/api-envelope";
import {
  parseRequestBody,
  type RouteContext,
} from "~/lib/route-wrapper-utils.server";
import { underOutsideHead } from "./catalog-outside-mounts";
import { commits, decodeContract } from "./client.server";
import { fileAnswer, multipart } from "./runtime";

/** A generated route entry, as `portalRoutes` lists it. */
export interface CatalogRoute {
  readonly method: string;
  readonly pattern: string;
  /** The query parameters the handler reads; nothing else is forwarded. */
  readonly query?: readonly string[];
  /** A decoder, or the decoders of a legacy route with response variants. */
  readonly response: unknown;
  /** The query parameter that picks a variant's decoder. */
  readonly variantParam?: string;
  /** The variant the backend answers without that parameter. */
  readonly defaultVariant?: string;
  /** Why the request runs only once, also after a session renewal. */
  readonly noRetryAfterRenewal?: string;
  /** Why a POST commits nothing its caller asked for (a preview, a search). */
  readonly noCommit?: string;
  /** The largest request body read; a larger one is answered 413. */
  readonly maxBodyBytes?: number;
  /** `multipart` for an upload; a JSON body names no runtime value. */
  readonly request?: unknown;
  /** The code of an upload over `maxBodyBytes`. */
  readonly tooLargeCode?: ErrorCode;
  /**
   * Why a file of the portal `public` may leave without a session: the
   * contract's marker of that one route. A public file without it is never
   * served.
   */
  readonly publicFile?: string;
  /**
   * Why an upload of the portal `public` may arrive without a session: the
   * contract's marker of that one route. A public upload without it is
   * never taken.
   */
  readonly publicUpload?: string;
  /**
   * The Cache-Control the proxy keeps on a file the backend handed out; every
   * other answer of the route stays private and uncached.
   */
  readonly fileCache?: string;
  /** Forward the validators of a conditional GET and hand back its 304. */
  readonly conditionalGet?: boolean;
  /** A file the browser may keep: its private Cache-Control passes. */
  readonly privateCache?: boolean;
}

export type CatalogMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type PortalHandlers = Pick<
  ReturnType<typeof makePortalHandlers>,
  | "get"
  | "post"
  | "put"
  | "patch"
  | "del"
  | "delWithBody"
  | "api"
  | "route"
  | "backendFetch"
>;

type Envelope = z.ZodType<{ data: unknown }>;

const segmentsOf = (path: string) => path.split("/").filter(Boolean);

/**
 * The Cache-Control a `privateCache` file leaves with: the backend's own
 * value when it keeps the file in the browser alone, else none at all. A
 * shared cache never stores a session's file.
 */
export function privateCacheControl(value: string | null): string {
  const directives = (value ?? "")
    .toLowerCase()
    .split(",")
    .map((directive) => directive.trim());
  return directives.includes("private") && !directives.includes("public")
    ? (value as string)
    : "private, no-store";
}

const MIB = 1024 * 1024;

/**
 * Passes a request body on unread and counts it; past `limit` bytes the
 * stream fails, which aborts the backend call.
 */
function boundedStream(body: ReadableStream<Uint8Array> | null, limit: number) {
  let size = 0;
  let over = false;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) {
        over = true;
        controller.error(new Error(`upload exceeds ${limit} bytes`));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return {
    body: body?.pipeThrough(counter),
    exceeded: () => over,
  };
}

const isParam = (segment: string) =>
  segment.startsWith("{") && segment.endsWith("}");

/** A parameter never stands for an empty or a dot segment. */
const UNSAFE_SEGMENTS = new Set(["", ".", ".."]);

const isDecoder = (value: unknown): value is Envelope =>
  typeof (value as { safeParse?: unknown } | null)?.safeParse === "function";

/**
 * A route this proxy can serve: one decoder for its one response shape, or
 * a decoder per variant together with the query parameter that picks one.
 */
type ServedRoute = CatalogRoute & {
  response: Envelope | Readonly<Record<string, Envelope>>;
};

const isFile = (route: CatalogRoute) => route.response === fileAnswer;
const isUpload = (route: CatalogRoute) => route.request === multipart;

/** A route whose body or answer the proxy streams instead of reading. */
const isStreamed = (route: CatalogRoute) => isFile(route) || isUpload(route);

/**
 * A file the contract opens to the portal `public`, route by route. An
 * upload never is one, and neither is a file without the marker.
 */
const isPublicFile = (route: CatalogRoute) =>
  isFile(route) &&
  !isUpload(route) &&
  typeof route.publicFile === "string" &&
  route.publicFile.length > 0;

/**
 * An upload the contract opens to the portal `public`, route by route
 * (#2352). It is bounded and streamed like a session upload.
 */
const isPublicUpload = (route: CatalogRoute) =>
  isUpload(route) &&
  !isFile(route) &&
  typeof route.publicUpload === "string" &&
  route.publicUpload.length > 0;

const PRIVATE_NO_STORE = "private, no-store";

/**
 * The Cache-Control values a file route may keep (contractmodel's
 * FileCacheValues). The list is closed here as well: a value an entry
 * carried that Go never reviewed leaves the file uncached.
 */
const PUBLIC_ASSET_CACHE = "public, max-age=86400";
const FILE_CACHE_VALUES = new Set([
  PUBLIC_ASSET_CACHE,
  "private, max-age=3600",
  "private, max-age=86400, immutable",
]);

/**
 * The cache a route's file answer keeps: a reviewed value, and a public one
 * only for a file its contract opens to the portal public.
 */
function cacheOf(route: CatalogRoute): string | null {
  const value = route.fileCache;
  if (value === undefined || !FILE_CACHE_VALUES.has(value)) return null;
  if (value.startsWith("public") && !isPublicFile(route)) return null;
  return value;
}

/** The request headers a conditional GET forwards. */
const CONDITIONAL_REQUEST_HEADERS = ["If-None-Match", "If-Modified-Since"];
/** The validators a conditional GET's answer hands back. */
const VALIDATOR_HEADERS = ["ETag", "Last-Modified"];

/**
 * Marks a file answer whose cache the route names, between building it and
 * the wrapper that makes every other answer private; never sent.
 */
const KEEP_CACHE_HEADER = "X-Moto-Catalog-Keep-Cache";

function conditionalHeaders(route: CatalogRoute, request: Request) {
  const headers: Record<string, string> = {};
  if (!route.conditionalGet || request.method !== "GET") return headers;
  for (const name of CONDITIONAL_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

/**
 * A file answer: the backend's bytes with their file headers, or its 304 on
 * a conditional GET. Only these keep the route's cache; an error or a
 * refusal leaves through the private, uncached path.
 */
async function fileAnswerOf(
  route: CatalogRoute,
  backend: Response,
  request: Request,
): Promise<Response> {
  const cache =
    cacheOf(route) ??
    (route.fileCache === undefined && route.privateCache && !isPublicFile(route)
      ? privateCacheControl(backend.headers.get("Cache-Control"))
      : null);
  if (route.conditionalGet && cache && backend.status === 304) {
    const headers = new Headers({
      "Cache-Control": cache,
      [KEEP_CACHE_HEADER]: "1",
    });
    copyHeaders(backend.headers, headers, VALIDATOR_HEADERS);
    return new Response(null, { status: 304, headers });
  }
  const response = await fileResponse(
    backend,
    request,
    cache ? { cacheControl: cache } : {},
  );
  if (cache && backend.ok && backend.body) {
    if (route.conditionalGet) {
      copyHeaders(backend.headers, response.headers, VALIDATOR_HEADERS);
    }
    response.headers.set(KEEP_CACHE_HEADER, "1");
  }
  return response;
}

function copyHeaders(from: Headers, to: Headers, names: readonly string[]) {
  for (const name of names) {
    const value = from.get(name);
    if (value) to.set(name, value);
  }
}

/**
 * Every answer of a file route is private and uncached, except a file the
 * route names a cache for (fileAnswerOf). The marker never leaves.
 */
function privateUnlessKept(response: Response): Response {
  const kept = response.headers.get(KEEP_CACHE_HEADER) !== null;
  // A fetch result handed through as is has immutable headers.
  const out = kept ? response : mutable(response);
  if (kept) {
    out.headers.delete(KEEP_CACHE_HEADER);
  } else {
    out.headers.set("Cache-Control", PRIVATE_NO_STORE);
  }
  return out;
}

function mutable(response: Response): Response {
  try {
    response.headers.set("Cache-Control", PRIVATE_NO_STORE);
    return response;
  } catch {
    return new Response(response.body, response);
  }
}

function isServable(route: CatalogRoute): route is ServedRoute {
  if (isDecoder(route.response) || isFile(route)) return true;
  const variants = route.response as Record<string, unknown> | null;
  return (
    route.variantParam !== undefined &&
    route.defaultVariant !== undefined &&
    typeof variants === "object" &&
    variants !== null &&
    isDecoder(variants[route.defaultVariant]) &&
    Object.values(variants).every(isDecoder)
  );
}

/**
 * The decoder of the answer the request asks for. A variant the contract
 * does not name is the backend's to refuse; were it answered, it is held to
 * the default variant.
 */
function decoderOf(route: ServedRoute, request: NextRequest): Envelope {
  if (isDecoder(route.response)) return route.response;
  const variants = route.response as Readonly<Record<string, Envelope>>;
  const asked = request.nextUrl.searchParams.get(route.variantParam ?? "");
  return (
    (asked !== null && Object.hasOwn(variants, asked)
      ? variants[asked]
      : undefined) ?? (variants[route.defaultVariant ?? ""] as Envelope)
  );
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
 * parameters travel. Session and the single 401 renewal are the portal's
 * own handlers; the answer is the backend's envelope with the decoded data.
 * A route's contract can switch the renewal's retry off and bound the body.
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
      .filter(isServable)
      // The session-free path answers JSON, and a file only where the
      // contract marks it; Go refuses an unmarked public file.
      .filter(
        (route) =>
          !isPublic ||
          !isStreamed(route) ||
          isPublicFile(route) ||
          isPublicUpload(route),
      )
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

  // An unknown path is mostly a tab whose app predates a release that moved
  // or removed the route: its code asks the reader to reload the page.
  const notFound = () =>
    bffError(404, "route not found", { code: "general.route_not_found" });

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

  /**
   * The backend's envelope with the decoded data: `status`, `data`, the
   * page of a paginated list and the backend's message pass on as the
   * backend wrote them (#2353).
   */
  function decoded(
    route: ServedRoute,
    request: NextRequest,
    answer: unknown,
  ): ApiResponse<unknown> | PaginatedApiResponse<unknown> {
    const result = decodeContract(
      `${route.method} ${route.pattern}`,
      decoderOf(route, request),
      answer,
      commits(route),
    );
    if (!result.ok) throw result.error.cause;
    const value = result.value as {
      data: unknown;
      pagination?: PaginatedApiResponse<unknown>["pagination"];
    };
    const message = (answer as { message?: unknown } | undefined)?.message;
    return {
      status: "success",
      data: value.data,
      ...(value.pagination !== undefined && { pagination: value.pagination }),
      ...(typeof message === "string" && message !== "" && { message }),
    };
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
    return NextResponse.json(decoded(route, request, answer));
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
    // A DELETE without data answers 204 as well, whatever envelope the
    // backend wrote around nothing.
    if (answer === undefined) return null;
    const envelope = decoded(route, request, answer);
    return envelope.data === null && !("pagination" in envelope)
      ? null
      : NextResponse.json(envelope);
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
    return NextResponse.json(decoded(route, request, answer));
  };

  /**
   * An upload's body leaves for the backend while the browser still sends
   * it, so it cannot be sent again after a session renewal; Auth.js renews
   * the token before it runs out, so a 401 here is the backend's refusal.
   * A body over the route's limit is answered 413 with the route's code:
   * by its Content-Length before any backend call, and while it streams if
   * it is longer than it said.
   */
  async function upload(
    route: CatalogRoute,
    request: NextRequest,
    endpoint: string,
    send: (
      body: ReadableStream<Uint8Array> | undefined,
      contentType: string,
    ) => Promise<Response> = (body, contentType) =>
      portal.backendFetch(request, endpoint, {
        method,
        body,
        contentType,
        idempotencyKey: request.headers.get("Idempotency-Key"),
        retry: { off: "the upload's body streams once" },
      }),
  ): Promise<Response> {
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) {
      throw bffError(400, "Expected a multipart upload");
    }
    const limit = route.maxBodyBytes ?? 0;
    const tooLarge = () =>
      bffError(413, `request body exceeds ${limit} bytes`, {
        code: route.tooLargeCode,
        details: { max_bytes: limit, max_mb: Math.floor(limit / MIB) },
      });
    const declared = request.headers.get("content-length");
    if (declared === null) {
      throw bffError(411, "an upload needs a Content-Length");
    }
    if (!/^\d+$/.test(declared)) throw bffError(400, "invalid Content-Length");
    if (Number(declared) > limit) throw tooLarge();
    const counted = boundedStream(request.body, limit);
    let response: Response;
    try {
      response = await send(counted.body, contentType);
    } catch (error) {
      if (counted.exceeded()) throw tooLarge();
      throw error;
    }
    if (counted.exceeded()) throw tooLarge();
    const answer = await readBackendJson<unknown>(response);
    return NextResponse.json(decoded(route as ServedRoute, request, answer), {
      status: response.status === 204 ? 200 : response.status,
    });
  }

  /**
   * A file streams through with its file headers (fileResponse), and every
   * answer of the route, refusals and session failures included, is private
   * and uncached unless its contract names a cache policy. A `privateCache`
   * file keeps the backend's private Cache-Control; `fileCache` names a
   * fixed reviewed value and takes precedence when both are present. A
   * file a POST asks for reads its JSON body within the route's limit, so
   * the renewal's retry can send it again.
   */
  function streamedHandler(route: CatalogRoute) {
    const handler = portal.route(async (request, _token, params) => {
      const { endpoint } = target(request, params.path);
      if (isUpload(route)) return upload(route, request, endpoint);
      const json =
        method === "GET"
          ? undefined
          : await parseRequestBody(request, route.maxBodyBytes);
      const backend = await portal.backendFetch(request, endpoint, {
        method,
        json,
        headers: conditionalHeaders(route, request),
        idempotencyKey:
          method === "GET" ? null : request.headers.get("Idempotency-Key"),
        ...(route.noRetryAfterRenewal && {
          retry: { off: route.noRetryAfterRenewal },
        }),
      });
      return fileAnswerOf(route, backend, request);
    });
    return async (request: NextRequest, context: RouteContext) =>
      privateUnlessKept(await handler(request, context));
  }

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
  type Handler = (
    request: NextRequest,
    context: RouteContext,
  ) => Promise<Response>;
  const handlers = new Map<CatalogRoute, Handler>();
  function handlerOf(route: CatalogRoute): Handler {
    let handler = handlers.get(route);
    if (!handler && isStreamed(route)) {
      handler = streamedHandler(route);
      handlers.set(route, handler);
    }
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
   * A public file (#2352): the link in the path is the only credential, so
   * the request carries no session, no bearer, no body and no idempotency
   * key; `sendBackend` adds the client IP the backend's limiter of the link
   * keys on. The bytes stream through with their file headers, and every
   * answer, a refusal included, is private and uncached.
   */
  async function servePublicFile(
    request: NextRequest,
    context: RouteContext,
  ): Promise<Response> {
    const { route, endpoint } = target(request, (await context.params)?.path);
    // A public asset embedded in a page waits for the backend no longer
    // than any other image of a public page.
    const backend = await sendBackend(endpoint, null, {
      method,
      request,
      ...(cacheOf(route) === PUBLIC_ASSET_CACHE && {
        timeout: "publicAsset" as const,
      }),
    });
    return fileAnswerOf(route, backend, request);
  }

  /**
   * A public upload (#2352): the form or the link in the path is all the
   * request carries. No session, no bearer, no cookie and no idempotency
   * key; `sendBackend` adds the client IP the backend counts the attempt
   * by, before it reads the body. The bound is the session upload's: the
   * Content-Length before the call and the bytes while they stream.
   */
  async function servePublicUpload(
    request: NextRequest,
    route: CatalogRoute,
    context: RouteContext,
  ): Promise<Response> {
    const { endpoint } = target(request, (await context.params)?.path);
    return upload(route, request, endpoint, (body, contentType) =>
      sendBackend(endpoint, null, { method, body, contentType, request }),
    );
  }

  /**
   * A public route: no session read, no bearer, no renewal. The body is
   * read within the route's limit; a write without one reads nothing.
   */
  async function servePublic(
    request: NextRequest,
    route: ServedRoute,
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
    return NextResponse.json(decoded(route, request, answer));
  }

  return async (request: NextRequest, context: RouteContext) => {
    const found = find((await context.params)?.path);
    if (!found?.isPublic) {
      if (found) return handlerOf(found.route)(request, context);
      const response = handleApiError(notFound(), request);
      applyPrivateNoStore(response.headers);
      return response;
    }
    const file = isPublicFile(found.route);
    let response: Response;
    try {
      response = file
        ? await servePublicFile(request, context)
        : isPublicUpload(found.route)
          ? await servePublicUpload(request, found.route, context)
          : await servePublic(request, found.route as ServedRoute, context);
    } catch (error) {
      response = handleApiError(error, request);
    }
    if (file) {
      response = privateUnlessKept(response);
    } else {
      applyPrivateNoStore(response.headers);
    }
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
  // Next passes `params: undefined` to a route file without a dynamic
  // segment (`auth/tenants/route.ts`); such a file has no tail.
  return (request: NextRequest, context: Partial<RouteContext> | undefined) =>
    handler(request, {
      params: Promise.resolve(context?.params).then((given) => {
        const params = given ?? {};
        const tail = params.path;
        const rest = Array.isArray(tail) ? tail : tail ? [tail] : [];
        const lead = typeof head === "function" ? head(params) : head;
        // An empty segment matches no route: the proxy answers 404.
        return { ...params, path: lead ? [...lead, ...rest] : [""] };
      }),
    });
}
