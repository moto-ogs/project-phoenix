import { type NextRequest } from "next/server";
import { sendBackend } from "~/lib/backend-client.server";
import {
  BackendUnavailableError,
  problemResponse,
} from "~/lib/api-response-error.server";
import { type Logger } from "~/lib/logger";
import { forwardBackendResponse } from "~/lib/backend-proxy-response.server";
import { captureBffException } from "~/lib/sentry-bff.server";
import { onDrain } from "~/lib/process-drain.server";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export interface SSEProxyOptions {
  /** Bearer token injected server-side (EventSource cannot set headers). */
  readonly token: string;
  /** Backend SSE path, e.g. "/api/sse/events". */
  readonly upstreamPath: string;
  /** Per-portal logger so log lines keep their component name. */
  readonly logger: Logger;
}

/**
 * Shared Server-Sent-Events proxy for the tenant and parent portals. Both portal
 * routes bypass the route wrapper (streaming, not buffered JSON) and inject their
 * JWT server-side; only the auth function, the upstream path, and the logger name
 * differ, so all of the load-bearing streaming / abort / cleanup plumbing lives
 * here once. A reader-leak or missed-cleanup fix made here applies to both portals
 * instead of having to be mirrored (and risk diverging) across two ~150-line files.
 *
 * The caller authenticates, extracts the token, and delegates here:
 *
 *   const session = await auth();
 *   if (!session?.user?.token) return problemResponse(401, "Unauthorized", request);
 *   return proxySSEStream(request, { token: session.user.token, upstreamPath, logger });
 */
export async function proxySSEStream(
  request: NextRequest,
  { token, upstreamPath, logger }: SSEProxyOptions,
): Promise<Response> {
  const upstreamController = new AbortController();
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    request.signal.removeEventListener("abort", handleClientAbort);
  };

  const handleClientAbort = () => {
    upstreamController.abort();
  };

  if (request.signal.aborted) {
    upstreamController.abort();
  } else {
    request.signal.addEventListener("abort", handleClientAbort, { once: true });
  }

  try {
    // Preserve query params (e.g. cache busters) though the backend ignores them.
    const qs = request.nextUrl.search ? request.nextUrl.search : "";
    // The backend answers its headers at once (connected event); the
    // header timeout of sendBackend does not cut off the running stream.
    const backendResponse = await sendBackend(`${upstreamPath}${qs}`, token, {
      headers: { Accept: "text/event-stream" },
      request,
      signal: upstreamController.signal,
    });

    if (!backendResponse.ok) {
      cleanup();
      logger.error("SSE backend connection failed", {
        status: backendResponse.status,
      });
      return forwardBackendResponse(backendResponse, request);
    }

    if (!backendResponse.body) {
      cleanup();
      return problemResponse(502, "No response body from backend", request);
    }

    const reader = backendResponse.body.getReader();
    let downstreamCancelled = false;
    let stopDrainWatch: () => void = () => undefined;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // This replica stops (#7226): end the stream cleanly, so the
        // browser sees EOF and reconnects to another replica.
        stopDrainWatch = onDrain(() => {
          if (downstreamCancelled) return;
          downstreamCancelled = true;
          cleanup();
          upstreamController.abort();
          controller.close();
        });
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            stopDrainWatch();
            cleanup();
            if (!downstreamCancelled) {
              controller.close();
            }
            return;
          }

          if (value && !downstreamCancelled) {
            controller.enqueue(value);
          }
        } catch (error) {
          stopDrainWatch();
          cleanup();

          if (
            downstreamCancelled ||
            request.signal.aborted ||
            isAbortError(error)
          ) {
            return;
          }

          controller.error(error);
        }
      },
      async cancel() {
        downstreamCancelled = true;
        stopDrainWatch();
        cleanup();
        upstreamController.abort();

        try {
          await reader.cancel();
        } catch {
          // Upstream may already be closed when the client disconnects.
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // Disable buffering for immediate event delivery.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    cleanup();

    if (request.signal.aborted || isAbortError(error)) {
      logger.debug("SSE proxy aborted", {
        aborted_by_client: request.signal.aborted,
      });
      return new Response(null, { status: 204 });
    }

    // sendBackend wraps an unreachable backend; report the network failure.
    const failure =
      error instanceof BackendUnavailableError ? error.cause : error;
    captureBffException(failure, request);
    logger.error("SSE proxy error", {
      error: failure instanceof Error ? failure.message : String(failure),
    });
    return problemResponse(500, "Internal server error", request);
  }
}
