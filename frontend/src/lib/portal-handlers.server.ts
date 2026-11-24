import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type {
  ResponseRouteHandler,
  ServerAuthRequest,
} from "~/server/auth/route-handler";
import {
  handleApiError,
  isApiResponseError,
} from "./api-response-error.server";
import {
  assertPortalRequestContext,
  createBackendFetch,
  renewalFailureResponse,
  renewSession,
  type PortalSession,
  type SessionCall,
} from "./backend-client.server";
import {
  createUnauthorizedResponse,
  extractParams,
  parseRequestBody,
  successResponse,
  type RouteContext,
} from "./route-wrapper-utils.server";

/** One portal's session plus the wrapper every route of the portal runs in. */
export interface PortalBinding extends PortalSession {
  withAuth: (
    handler: (
      request: ServerAuthRequest,
      context: RouteContext,
    ) => Promise<Response>,
  ) => ResponseRouteHandler<RouteContext>;
}

type Params = Record<string, unknown>;

/**
 * A handler's result: data the factory answers in the backend's envelope
 * `{ status, data }`, or a Response it answers as it is.
 */
type NoBodyHandler<T> = (
  request: NextRequest,
  token: string,
  params: Params,
) => Promise<T>;

type WithBodyHandler<T, B> = (
  request: NextRequest,
  body: B,
  token: string,
  params: Params,
) => Promise<T>;

type HandlerOptions = Pick<SessionCall, "retry">;

interface BodyOptions extends HandlerOptions {
  /** Reject a larger request body with 413 while reading it. */
  maxBodyBytes?: number;
}

const json = (data: unknown) =>
  data instanceof Response ? data : NextResponse.json(successResponse(data));

/** A DELETE without a result answers 204, in every portal. */
const deleted = (data: unknown) =>
  data === null || data === undefined
    ? new NextResponse(null, { status: 204 })
    : json(data);

/**
 * Route handlers for one portal, all on the same backend client and with one
 * response contract. A handler that throws a backend 401 runs once more with
 * the renewed session's token; a refused renewal answers "Token expired", an
 * undecided one 503, a
 * second 401 is the backend's refusal and keeps its body.
 */
export function makePortalHandlers(portal: PortalBinding) {
  const backendFetch = createBackendFetch(portal);

  async function runWithRenewal<T>(
    request: NextRequest,
    token: string,
    run: (token: string) => Promise<T>,
  ): Promise<T | Response> {
    assertPortalRequestContext(portal);
    try {
      return await run(token);
    } catch (error) {
      if (!isApiResponseError(error, 401)) throw error;
    }
    const renewal = await renewSession(portal, token);
    if (renewal.outcome !== "renewed") {
      return renewalFailureResponse(renewal.outcome, request);
    }
    return run(renewal.token);
  }

  function route(
    run: (
      request: NextRequest,
      token: string,
      params: Params,
    ) => Promise<Response>,
  ): ResponseRouteHandler<RouteContext> {
    return portal.withAuth(async (request, context) => {
      try {
        const token = (await portal.auth())?.user?.token;
        if (!token) return createUnauthorizedResponse(request);
        return await run(request, token, await extractParams(request, context));
      } catch (error) {
        return handleApiError(error, request);
      }
    });
  }

  /** A handler's backend 401 runs it again unless the endpoint opts out. */
  const renewing = <T>(
    options: HandlerOptions | undefined,
    request: NextRequest,
    token: string,
    run: (token: string) => Promise<T>,
  ) =>
    options?.retry === undefined || options.retry === true
      ? runWithRenewal(request, token, run)
      : run(token);

  const noBody =
    (format: (data: unknown) => Response) =>
    <T>(handler: NoBodyHandler<T>, options?: HandlerOptions) =>
      route(async (request, token, params) => {
        const result = await renewing(options, request, token, (current) =>
          handler(request, current, params),
        );
        return result instanceof Response ? result : format(result);
      });

  const withBody =
    (format: (data: unknown) => Response) =>
    <T, B = unknown>(handler: WithBodyHandler<T, B>, options?: BodyOptions) =>
      route(async (request, token, params) => {
        const body = await parseRequestBody<B>(request, options?.maxBodyBytes);
        const result = await renewing(options, request, token, (current) =>
          handler(request, body, current, params),
        );
        return result instanceof Response ? result : format(result);
      });

  const get = noBody(json);
  const post = withBody(json);
  const put = withBody(json);
  const patch = withBody(json);
  const del = noBody(deleted);
  const delWithBody = withBody(deleted);

  return {
    route,
    runWithRenewal,
    get,
    post,
    put,
    patch,
    del,
    delWithBody,
    backendFetch,
  };
}
