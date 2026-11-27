export type { SSEEvent } from "./contract/stream-event.generated";
import type { SSEEvent } from "./contract/stream-event.generated";

export type ConnectionStatus = "connected" | "reconnecting" | "failed" | "idle";

export interface SSEHookOptions {
  onMessage?: (event: SSEEvent) => void;
  enabled?: boolean; // when false, do not establish EventSource
  reconnectKey?: string | number; // when this changes, force teardown+reconnect (e.g. tenantId)
}

export interface SSEHookState {
  isConnected: boolean;
  status: ConnectionStatus;
}
