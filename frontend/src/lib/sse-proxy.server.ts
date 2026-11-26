import { type NextRequest } from "next/server";
import { readBackendError, sendBackend } from "~/lib/backend-client.server";
import {
  handleApiError,
  problemResponse,
} from "~/lib/api-response-error.server";
import { type Logger } from "~/lib/logger";
import { applyPrivateNoStore } from "~/lib/private-no-store";
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
 * Streams events for the tenant, school and parent portals. Each route
 * authenticates and injects its JWT server-side.
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
      throw await readBackendError(backendResponse);
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

    const response = handleApiError(error, request);
    applyPrivateNoStore(response.headers);
    return response;
  }
}
