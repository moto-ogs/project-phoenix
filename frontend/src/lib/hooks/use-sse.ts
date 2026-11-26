import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { FetchEventSource } from "~/lib/fetch-event-source";
import type {
  SSEEvent,
  SSEHookOptions,
  SSEHookState,
  ConnectionStatus,
} from "../sse-types";
import { createLogger } from "~/lib/logger";

// Logger instance for SSE connection
const logger = createLogger({ component: "SSE" });

/**
 * React hook for Server-Sent Events (SSE) with auto-reconnection
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Connection state tracking
 * - Cleanup on unmount
 * - Event parsing and error handling
 *
 * @param endpoint - The SSE endpoint URL (e.g., '/api/sse/events')
 * @param options - Hook configuration options
 * @returns Connection state (isConnected, error, reconnectAttempts)
 */
export function useSSE(
  endpoint: string,
  options: SSEHookOptions = {},
): SSEHookState {
  const {
    onMessage,
    onError,
    reconnectInterval = 1000, // Start with 1 second
    maxReconnectAttempts = 5,
    enabled = true,
    reconnectKey,
  } = options;

  const { data: session } = useSession();
  // The stream is bound to the tab's account (#5385). A provider answer for
  // the same account and authorization leaves an open stream alone (#5017).
  // Otherwise every session poll would create a gap to reconcile. It still
  // restarts a stream that is down, refused or out of retries
  // (restartIfDownRef).
  const sessionAccount = session?.user?.id ?? null;
  // The server snapshots authorization when opening the stream. Replace it
  // when rights change, but not for fresh arrays or a different array order.
  const sessionAuthorization = JSON.stringify([
    session?.user?.isAdmin ?? false,
    [...(session?.user?.roles ?? [])].sort(),
    [...(session?.user?.permissions ?? [])].sort(),
  ]);

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const eventSourceRef = useRef<FetchEventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const reconnectAttemptsRef = useRef(0); // Track live count to avoid stale closure
  const reconnectKeyRef = useRef(reconnectKey);
  const confirmedAccountRef = useRef(sessionAccount);
  const confirmedAuthorizationRef = useRef(sessionAuthorization);
  const restartIfDownRef = useRef<() => void>(() => undefined);

  // Stable onMessage callback
  const stableOnMessage = useCallback(
    (event: SSEEvent) => {
      if (mountedRef.current) {
        onMessage?.(event);
      }
    },
    [onMessage],
  );

  // Stable onError callback
  const stableOnError = useCallback(
    (err: Event) => {
      if (mountedRef.current) {
        onError?.(err);
      }
    },
    [onError],
  );

  // connect() stores every EventSource in eventSourceRef; the cleanup below
  // closes that ref and clears the reconnect timer. The scanner cannot follow
  // the nested connection factory to its cleanup.
  useEffect(() => {
    const reconnectKeyChanged =
      reconnectKeyRef.current !== reconnectKey ||
      confirmedAccountRef.current !== sessionAccount ||
      confirmedAuthorizationRef.current !== sessionAuthorization;
    confirmedAccountRef.current = sessionAccount;
    confirmedAuthorizationRef.current = sessionAuthorization;
    reconnectKeyRef.current = reconnectKey;

    if (!enabled) {
      reconnectAttemptsRef.current = 0;
      setIsConnected(false);
      setError(null);
      setReconnectAttempts(0);
      return;
    }
    // Ensure mountedRef is true when effect runs (critical for reconnection)
    mountedRef.current = true;

    // A reconnect-key change replaces an open EventSource during cleanup. Mark
    // the gap explicitly so consumers can reconcile after the replacement
    // stream opens, instead of retaining the prior connection's state.
    if (reconnectKeyChanged) {
      setIsConnected(false);
      setError(null);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
    }

    // Event handler for SSE messages - handles parsing and error reporting
    const handleSSEMessage = (
      eventSource: FetchEventSource,
      eventType: string,
      event: Event,
      parse: (value: unknown) => SSEEvent,
    ) => {
      if (!mountedRef.current || eventSourceRef.current !== eventSource) return;
      try {
        const messageEvent = event as MessageEvent;
        const parsed = parse(JSON.parse(String(messageEvent.data)));
        stableOnMessage(parsed);
      } catch (err) {
        logger.error("failed to parse sse event", {
          endpoint,
          event_type: eventType,
          error: err instanceof Error ? err.message : String(err),
        });
        setError(
          eventType === "message"
            ? "Ungültige Server-Event-Daten empfangen"
            : `Ungültige Server-Event-Daten (${eventType})`,
        );
      }
    };

    let sessionRefused = false;
    let disposed = false;
    let connecting = false;
    const connect = async () => {
      if (disposed || connecting) return;
      connecting = true;

      // Reconnection callback
      const attemptReconnect = () => {
        if (mountedRef.current) {
          void connect();
        }
      };

      try {
        const { SSEEventSchema, STREAM_EVENT_TYPE_VALUES } =
          await import("~/lib/contract/stream-event.generated");
        if (disposed) return;
        const eventSource = new FetchEventSource(endpoint);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          if (!mountedRef.current || eventSourceRef.current !== eventSource) {
            return;
          }
          setIsConnected(true);
          setError(null);
          reconnectAttemptsRef.current = 0; // Reset ref
          setReconnectAttempts(0); // Reset state
        };

        eventSource.onmessage = (event) =>
          handleSSEMessage(eventSource, "message", event, SSEEventSchema.parse);

        // Handle specific event types
        for (const eventType of STREAM_EVENT_TYPE_VALUES) {
          eventSource.addEventListener(eventType, (event) =>
            handleSSEMessage(
              eventSource,
              eventType,
              event,
              SSEEventSchema.parse,
            ),
          );
        }

        eventSource.onerror = (err) => {
          if (!mountedRef.current || eventSourceRef.current !== eventSource) {
            return;
          }

          // readyState CLOSED: the server answered, but not with a stream
          // (401, 5xx). Otherwise the stream dropped without an answer:
          // unavailable, which the logger records as an expected network
          // failure (#2512).
          logger.error("sse connection error", {
            ...(eventSource.readyState !== 2 && {
              error_class: "unavailable",
            }),
            endpoint,
            ready_state: eventSource?.readyState,
            error_type: err.type,
            is_online:
              typeof navigator !== "undefined" ? navigator.onLine : true,
          });

          setIsConnected(false);
          // classify likely causes
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            setError("Netzwerkverbindung unterbrochen");
          } else if (eventSource?.readyState === 2) {
            setError("SSE-Verbindung vom Server geschlossen");
          } else {
            setError("SSE-Verbindungsfehler");
          }
          stableOnError(err);

          sessionRefused = eventSource.sessionRefused;

          // Close the failed connection
          eventSource?.close();
          eventSourceRef.current = null;

          // A session refusal waits for the provider/cache reconciliation,
          // not a timer or a wake event that would repeat the same refusal.
          if (sessionRefused) return;

          // Attempt reconnection with exponential backoff
          // Read from ref to get live count (not stale closure value)
          const currentAttempts = reconnectAttemptsRef.current;

          if (currentAttempts < maxReconnectAttempts) {
            // Exponential backoff with proportional jitter (up to +100% of the
            // base delay): a backend restart drops every client of the
            // deployment at the same instant, and without jitter they all
            // reconnected — and revalidated — in synchronized waves (#2057).
            const base = reconnectInterval * Math.pow(2, currentAttempts);
            // Math.random is fine here: reconnect jitter, no security context.
            const delay = base + Math.random() * base;

            // Update both ref (for next closure) and state (for UI)
            reconnectAttemptsRef.current = currentAttempts + 1;
            setReconnectAttempts(currentAttempts + 1);

            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
            }

            reconnectTimeoutRef.current = setTimeout(attemptReconnect, delay);
          } else {
            setError("Max reconnection attempts reached");
            logger.warn("sse max reconnection attempts reached", {
              endpoint,
              max_attempts: maxReconnectAttempts,
            });
          }
        };
      } catch (err) {
        if (disposed) return;
        logger.error("failed to create eventsource", {
          endpoint,
          error: err instanceof Error ? err.message : String(err),
        });
        setError("Failed to establish SSE connection");
      } finally {
        connecting = false;
      }
    };

    // Initial connection
    void connect();

    // Reconnect when device wakes from sleep or network restores
    const handleWakeReconnect = () => {
      if (!mountedRef.current || sessionRefused) return;
      // Skip if already connected
      if (eventSourceRef.current?.readyState === 1) {
        return;
      }

      // Close dead connection if it exists
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // Clear any pending reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Reset attempts so we get fresh retries
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
      setIsConnected(false);

      void connect();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleWakeReconnect();
      }
    };

    const handleOnline = () => {
      handleWakeReconnect();
    };

    // A confirmed provider session resumes a refused stream and retries one
    // that is down or out of retries; an open or opening stream stays.
    restartIfDownRef.current = () => {
      if (!mountedRef.current) return;
      const readyState = eventSourceRef.current?.readyState;
      if (readyState === 0 || readyState === 1) return;
      sessionRefused = false;
      handleWakeReconnect();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    globalThis.addEventListener("online", handleOnline);

    // Cleanup on unmount
    return () => {
      disposed = true;
      mountedRef.current = false;
      restartIfDownRef.current = () => undefined;

      document.removeEventListener("visibilitychange", handleVisibilityChange);
      globalThis.removeEventListener("online", handleOnline);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [
    endpoint,
    stableOnMessage,
    stableOnError,
    reconnectInterval,
    maxReconnectAttempts,
    enabled,
    reconnectKey,
    sessionAccount,
    sessionAuthorization,
  ]);

  // Every provider answer (lookup, poll, update()) confirms the session.
  const confirmedSessionRef = useRef(session);
  useEffect(() => {
    if (confirmedSessionRef.current === session) return;
    confirmedSessionRef.current = session;
    restartIfDownRef.current();
  }, [session]);

  // Compute connection status based on state
  const status = useMemo<ConnectionStatus>(() => {
    if (isConnected) return "connected";
    if (reconnectAttempts >= maxReconnectAttempts) return "failed";
    if (reconnectAttempts > 0) return "reconnecting";
    return "idle";
  }, [isConnected, reconnectAttempts, maxReconnectAttempts]);

  return {
    isConnected,
    error,
    reconnectAttempts,
    status,
  };
}
