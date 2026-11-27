import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSSE } from "../use-sse";
import type { SSEEvent } from "../../sse-types";

// Retry/state tests isolate the transport; fetch-boundary tests live next to
// use-sse.ts and exercise the real streaming implementation.
vi.mock("~/lib/fetch-event-source", () => ({
  FetchEventSource: class {
    constructor(url: string) {
      return new EventSource(url);
    }
  },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
  getSession: vi.fn(),
}));

// Mock EventSource
class MockEventSource {
  public url: string;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public readyState = 0;
  public CONNECTING = 0;
  public OPEN = 1;
  public CLOSED = 2;
  private readonly eventListeners = new Map<
    string,
    ((event: Event) => void)[]
  >();

  constructor(url: string) {
    this.url = url;
    this.readyState = this.CONNECTING;
    // Tests will explicitly call triggerOpen() when ready
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  close(): void {
    this.readyState = this.CLOSED;
  }

  // Test helper: is a named-event listener registered? Mirrors real
  // EventSource semantics — a `event: <type>` frame is only delivered when a
  // listener for that exact type was added; otherwise it is dropped (it does
  // NOT fall back to onmessage). Lets tests assert that use-sse subscribed to a
  // given backend event type (issue #848: bulk_student_checkout was emitted but
  // never listened for, so the client silently ignored it).
  hasListener(type: string): boolean {
    return (this.eventListeners.get(type)?.length ?? 0) > 0;
  }

  // Test helper methods. Each one wraps the callback in act(), like a
  // browser event that React processes before the next check, so waitFor sees
  // the resulting state without waiting for its next polling interval.
  triggerOpen(): void {
    this.readyState = this.OPEN;
    act(() => {
      this.onopen?.(new Event("open"));
    });
  }

  triggerMessage(data: SSEEvent, eventType?: string): void {
    const event = new MessageEvent(eventType ?? "message", {
      data: JSON.stringify(data),
    });

    act(() => {
      if (eventType && this.eventListeners.has(eventType)) {
        this.eventListeners.get(eventType)!.forEach((listener) => {
          listener(event);
        });
      } else if (this.onmessage) {
        this.onmessage(event);
      }
    });
  }

  triggerError(): void {
    this.readyState = this.CLOSED;
    act(() => {
      this.onerror?.(new Event("error"));
    });
  }
}

describe("useSSE Hook", () => {
  let mockEventSource: MockEventSource | null = null;
  let eventSourceInstances: MockEventSource[] = [];

  // Helper: Wait for EventSource to be created and handlers attached
  const waitForEventSource = async (timeout = 500) => {
    await waitFor(
      () => {
        expect(mockEventSource).toBeTruthy();
        expect(mockEventSource?.onopen).toBeTruthy();
      },
      { timeout },
    );
  };

  // Helper: Get the latest EventSource instance
  const getLatestEventSource = () => eventSourceInstances.at(-1);
  const requireLatestEventSource = () => {
    const instance = getLatestEventSource();
    if (!instance) {
      throw new Error("EventSource instance not initialized");
    }
    return instance;
  };

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    eventSourceInstances = [];

    // Replace global EventSource with our mock
    // IMPORTANT: Must use a class or function constructor, NOT an arrow function
    // Arrow functions cannot be used with 'new' in Vitest 4.x
    const setMockInstance = (instance: MockEventSource) => {
      mockEventSource = instance;
      eventSourceInstances.push(instance);
    };

    class EventSourceMock extends MockEventSource {
      constructor(url: string) {
        super(url);
        setMockInstance(this);
      }
    }
    vi.stubGlobal("EventSource", EventSourceMock);

    // Mock console methods to reduce test noise
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockEventSource = null;
    eventSourceInstances = [];
  });

  describe("Initial Connection", () => {
    it("should start in idle state", () => {
      const { result } = renderHook(() => useSSE("/api/sse/events"));

      expect(result.current.isConnected).toBe(false);
      expect(result.current.status).toBe("idle");
    });

    it("should establish connection on mount", async () => {
      const { result } = renderHook(() => useSSE("/api/sse/events"));

      // Wait for EventSource to be created and handlers attached
      await waitForEventSource();

      // Trigger connection success
      mockEventSource?.triggerOpen();

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
          expect(result.current.status).toBe("connected");
        },
        { timeout: 500 },
      );
    });

    it("should call onMessage when event received", async () => {
      const onMessage = vi.fn();
      const { result } = renderHook(() =>
        useSSE("/api/sse/events", { onMessage }),
      );

      await waitForEventSource();
      mockEventSource?.triggerOpen();

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 500 },
      );

      const testEvent: SSEEvent = {
        type: "student_checkin",
        active_group_id: "123",
        data: {
          student_id: "456",
        },
        timestamp: new Date().toISOString(),
      };

      mockEventSource?.triggerMessage(testEvent);

      await waitFor(
        () => {
          expect(onMessage).toHaveBeenCalledWith(testEvent);
        },
        { timeout: 500 },
      );
    });

    it("should handle typed events (student_checkin, etc.)", async () => {
      const onMessage = vi.fn();
      renderHook(() => useSSE("/api/sse/events", { onMessage }));

      await waitForEventSource();
      mockEventSource?.triggerOpen();

      const testEvent: SSEEvent = {
        type: "student_checkin",
        active_group_id: "123",
        data: { student_id: "456" },
        timestamp: new Date().toISOString(),
      };

      mockEventSource?.triggerMessage(testEvent, "student_checkin");

      await waitFor(
        () => {
          expect(onMessage).toHaveBeenCalledWith(testEvent);
        },
        { timeout: 500 },
      );
    });

    it("subscribes to bulk_student_checkin named events", async () => {
      const onMessage = vi.fn();
      renderHook(() => useSSE("/api/sse/events", { onMessage }));

      await waitForEventSource();
      mockEventSource?.triggerOpen();

      expect(
        requireLatestEventSource().hasListener("bulk_student_checkin"),
      ).toBe(true);

      const testEvent: SSEEvent = {
        type: "bulk_student_checkin",
        active_group_id: "123",
        data: { student_ids: ["42", "77"] },
        timestamp: new Date().toISOString(),
      };

      mockEventSource?.triggerMessage(testEvent, "bulk_student_checkin");

      await waitFor(
        () => {
          expect(onMessage).toHaveBeenCalledWith(testEvent);
        },
        { timeout: 500 },
      );
    });

    it("subscribes to bulk_student_checkout named events (issue #848)", async () => {
      const onMessage = vi.fn();
      renderHook(() => useSSE("/api/sse/events", { onMessage }));

      await waitForEventSource();
      mockEventSource?.triggerOpen();

      // The backend writes `event: bulk_student_checkout` named frames. Browser
      // EventSource delivers named events ONLY to a matching addEventListener —
      // never to onmessage. If use-sse forgets to register this type the client
      // silently drops the whole-session-end batch (the original #848 gap).
      expect(
        requireLatestEventSource().hasListener("bulk_student_checkout"),
      ).toBe(true);

      const testEvent: SSEEvent = {
        type: "bulk_student_checkout",
        active_group_id: "123",
        data: { student_ids: ["42", "77"] },
        timestamp: new Date().toISOString(),
      };

      mockEventSource?.triggerMessage(testEvent, "bulk_student_checkout");

      await waitFor(
        () => {
          expect(onMessage).toHaveBeenCalledWith(testEvent);
        },
        { timeout: 500 },
      );
    });

    it("should handle active_supervision_changed typed events", async () => {
      const onMessage = vi.fn();
      renderHook(() => useSSE("/api/sse/events", { onMessage }));

      await waitForEventSource();
      mockEventSource?.triggerOpen();

      const testEvent: SSEEvent = {
        type: "active_supervision_changed",
        active_group_id: "123",
        data: { reason: "instance_started" },
        timestamp: new Date().toISOString(),
      };

      mockEventSource?.triggerMessage(testEvent, "active_supervision_changed");

      await waitFor(
        () => {
          expect(onMessage).toHaveBeenCalledWith(testEvent);
        },
        { timeout: 500 },
      );
    });

    it("should handle tenant_settings_changed as a named SSE event", async () => {
      const onMessage = vi.fn();
      renderHook(() => useSSE("/api/sse/events", { onMessage }));

      await waitForEventSource();
      mockEventSource?.triggerOpen();

      const testEvent: SSEEvent = {
        type: "tenant_settings_changed",
        active_group_id: "",
        data: { source: "operations.student_photos_enabled" },
        timestamp: new Date().toISOString(),
      };

      mockEventSource?.triggerMessage(testEvent, "tenant_settings_changed");

      await waitFor(
        () => {
          expect(onMessage).toHaveBeenCalledWith(testEvent);
        },
        { timeout: 500 },
      );
    });
  });

  describe("Reconnection Logic", () => {
    it("clears connected state while replacing an EventSource for a reconnect key", async () => {
      const { result, rerender } = renderHook(
        ({ reconnectKey }) => useSSE("/api/sse/events", { reconnectKey }),
        { initialProps: { reconnectKey: "before" } },
      );

      await waitForEventSource();
      requireLatestEventSource().triggerOpen();
      await waitFor(() => expect(result.current.isConnected).toBe(true), {
        timeout: 500,
      });

      rerender({ reconnectKey: "after" });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(eventSourceInstances).toHaveLength(2);
      });
    });

    it("ignores callbacks from a replaced EventSource", async () => {
      const { result, rerender } = renderHook(
        ({ reconnectKey }) => useSSE("/api/sse/events", { reconnectKey }),
        { initialProps: { reconnectKey: "before" } },
      );

      await waitForEventSource();
      const replacedEventSource = requireLatestEventSource();
      replacedEventSource.triggerOpen();
      await waitFor(() => expect(result.current.isConnected).toBe(true), {
        timeout: 500,
      });

      rerender({ reconnectKey: "after" });
      await waitFor(() => expect(eventSourceInstances).toHaveLength(2));
      const activeEventSource = requireLatestEventSource();

      replacedEventSource.triggerOpen();
      replacedEventSource.triggerError();

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.status).toBe("idle");
      });

      activeEventSource.triggerOpen();
      await waitFor(() => expect(result.current.isConnected).toBe(true), {
        timeout: 500,
      });
    });

    it("resets retry state when a reconnect key replaces a failed stream", async () => {
      const { result, rerender } = renderHook(
        ({ reconnectKey }) => useSSE("/api/sse/events", { reconnectKey }),
        { initialProps: { reconnectKey: "before" } },
      );

      await waitForEventSource();
      requireLatestEventSource().triggerOpen();
      await waitFor(() => expect(result.current.isConnected).toBe(true), {
        timeout: 500,
      });

      requireLatestEventSource().triggerError();
      await waitFor(() => expect(result.current.status).toBe("reconnecting"), {
        timeout: 500,
      });

      rerender({ reconnectKey: "after" });

      await waitFor(() => {
        expect(result.current.status).toBe("idle");
      });
    });

    it("should attempt reconnection on error", async () => {
      const { result } = renderHook(() => useSSE("/api/sse/events"));

      // Initial connection
      await waitForEventSource();
      mockEventSource?.triggerOpen();

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 500 },
      );

      // Trigger error
      mockEventSource?.triggerError();

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(false);
          expect(result.current.status).toBe("reconnecting");
        },
        { timeout: 500 },
      );
    });

    it("backs off across five retries, then waits for a wake event", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { result } = renderHook(() => useSSE("/api/sse/events"));
      await advance(0);
      requireLatestEventSource().triggerOpen();

      for (const [index, delay] of [1000, 2000, 4000, 8000, 16000].entries()) {
        requireLatestEventSource().triggerError();
        expect(result.current.status).toBe(
          index < 4 ? "reconnecting" : "failed",
        );
        await advance(delay - 1);
        expect(eventSourceInstances).toHaveLength(index + 1);
        await advance(1);
        expect(eventSourceInstances).toHaveLength(index + 2);
      }
      requireLatestEventSource().triggerError();
      expect(result.current.status).toBe("failed");
      await advance(32000);
      expect(eventSourceInstances).toHaveLength(6);

      act(() => window.dispatchEvent(new Event("online")));
      await advance(0);
      expect(eventSourceInstances).toHaveLength(7);
      expect(result.current.status).toBe("idle");
      requireLatestEventSource().triggerOpen();
      expect(result.current.status).toBe("connected");
    });

    it("resets the retry count when the stream opens again", async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { result } = renderHook(() => useSSE("/api/sse/events"));
      await advance(0);
      requireLatestEventSource().triggerOpen();
      expect(result.current.status).toBe("connected");

      requireLatestEventSource().triggerError();
      expect(result.current.status).toBe("reconnecting");
      await advance(1000);
      expect(eventSourceInstances).toHaveLength(2);

      requireLatestEventSource().triggerOpen();
      expect(result.current.status).toBe("connected");

      // After a successful retry, a later drop starts at the first delay again.
      requireLatestEventSource().triggerError();
      await advance(1000);
      expect(eventSourceInstances).toHaveLength(3);
    });
  });

  describe("Status Transitions", () => {
    it("should transition: idle → connected", async () => {
      const { result } = renderHook(() => useSSE("/api/sse/events"));

      expect(result.current.status).toBe("idle");

      await waitForEventSource();
      mockEventSource?.triggerOpen();

      await waitFor(
        () => {
          expect(result.current.status).toBe("connected");
        },
        { timeout: 500 },
      );
    });

    it("should transition: connected → reconnecting", async () => {
      const { result } = renderHook(() => useSSE("/api/sse/events"));

      await waitForEventSource();
      mockEventSource?.triggerOpen();
      await waitFor(
        () => {
          expect(result.current.status).toBe("connected");
        },
        { timeout: 500 },
      );

      mockEventSource?.triggerError();

      await waitFor(
        () => {
          expect(result.current.status).toBe("reconnecting");
        },
        { timeout: 500 },
      );
    });
  });

  describe("Cleanup on Unmount", () => {
    it("should close EventSource on unmount", async () => {
      const { unmount } = renderHook(() => useSSE("/api/sse/events"));

      await waitForEventSource();
      const instance = requireLatestEventSource();
      instance.triggerOpen();

      const closeSpy = vi.spyOn(instance, "close");

      unmount();

      expect(closeSpy).toHaveBeenCalled();
    });

    it("clears the scheduled retry on unmount", async () => {
      vi.useFakeTimers();
      const { unmount } = renderHook(() => useSSE("/api/sse/events"));
      await advance(0);
      const instance = requireLatestEventSource();
      instance.triggerOpen();
      instance.triggerError();
      expect(vi.getTimerCount()).toBe(1);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
      expect(instance.readyState).toBe(instance.CLOSED);
    });

    it("should prevent state updates after unmount", async () => {
      const { result, unmount } = renderHook(() => useSSE("/api/sse/events"));

      await waitForEventSource();
      const instance = requireLatestEventSource();
      instance.triggerOpen();
      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 500 },
      );

      unmount();

      // Try to trigger events after unmount (should not cause errors)
      expect(() => {
        instance.triggerMessage({
          type: "student_checkin",
          active_group_id: "123",
          data: {},
          timestamp: new Date().toISOString(),
        });
      }).not.toThrow();
    });
  });

  describe("Error Handling", () => {
    it("should handle parse errors gracefully", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const onMessage = vi.fn();
      const { result } = renderHook(() =>
        useSSE("/api/sse/events", { onMessage }),
      );

      await waitForEventSource();
      mockEventSource?.triggerOpen();

      // Send invalid JSON
      const invalidEvent = new MessageEvent("message", {
        data: "invalid json{{{",
      });

      mockEventSource!.onmessage?.(invalidEvent);

      // Wait a bit to ensure no message was processed
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // Should not crash, onMessage should not be called
      expect(onMessage).not.toHaveBeenCalled();
      expect(result.current.status).toBe("connected");
      const validEvent: SSEEvent = {
        type: "activity_start",
        active_group_id: "1",
        timestamp: new Date().toISOString(),
        data: {},
      };
      requireLatestEventSource().triggerMessage(validEvent);
      expect(onMessage).toHaveBeenCalledExactlyOnceWith(validEvent);
    });
  });

  describe("Event Parsing", () => {
    it("should parse JSON event data correctly", async () => {
      const onMessage = vi.fn();
      const { result } = renderHook(() =>
        useSSE("/api/sse/events", { onMessage }),
      );

      // Wait for connection to be established
      await waitForEventSource();
      mockEventSource?.triggerOpen();
      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 500 },
      );

      const testEvent: SSEEvent = {
        type: "activity_start",
        active_group_id: "789",
        data: {
          activity_name: "Test Activity",
          room_id: "5",
          supervisor_ids: ["1", "2"],
        },
        timestamp: new Date().toISOString(),
      };

      mockEventSource?.triggerMessage(testEvent);

      await waitFor(
        () => {
          expect(onMessage).toHaveBeenCalled();
        },
        { timeout: 500 },
      );

      const lastCall = onMessage.mock.calls.at(-1);
      expect(lastCall).toBeDefined();

      const [payload] = lastCall as [SSEEvent];
      expect(payload.type).toBe("activity_start");
      expect(payload.active_group_id).toBe("789");
      expect(payload.data.activity_name).toBe("Test Activity");
    });

    it("should handle all event types", async () => {
      const onMessage = vi.fn();
      const { result } = renderHook(() =>
        useSSE("/api/sse/events", { onMessage }),
      );

      // Wait for connection to be established
      await waitForEventSource();
      mockEventSource?.triggerOpen();
      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 500 },
      );

      const eventTypes: Array<SSEEvent["type"]> = [
        "student_checkin",
        "student_checkout",
        "activity_start",
        "activity_end",
        "activity_update",
        "dashboard_counts_changed",
        "staff_time_tracking_changed",
      ];

      for (const eventType of eventTypes) {
        mockEventSource?.triggerMessage(
          {
            type: eventType,
            active_group_id: "123",
            data: {},
            timestamp: new Date().toISOString(),
          },
          eventType,
        );
      }

      await waitFor(
        () => {
          expect(onMessage).toHaveBeenCalledTimes(eventTypes.length);
        },
        { timeout: 500 },
      );
    });
  });

  describe("Sleep/Wake Reconnection", () => {
    it("should reconnect on visibilitychange when EventSource is closed", async () => {
      const { result } = renderHook(() => useSSE("/api/sse/events"));

      await waitForEventSource();
      const firstInstance = requireLatestEventSource();
      firstInstance.triggerOpen();
      await waitFor(() => expect(result.current.isConnected).toBe(true), {
        timeout: 500,
      });

      // Simulate connection dying (e.g., device sleep)
      firstInstance.readyState = firstInstance.CLOSED;

      // Simulate tab becoming visible again
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      // Should create a new EventSource
      await waitFor(() => expect(eventSourceInstances.length).toBe(2), {
        timeout: 500,
      });
      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.status).toBe("idle");
      });

      const secondInstance = requireLatestEventSource();
      secondInstance.triggerOpen();

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
          expect(result.current.status).toBe("connected");
        },
        { timeout: 500 },
      );
    });

    it("should reconnect on online event when EventSource is closed", async () => {
      const { result } = renderHook(() => useSSE("/api/sse/events"));

      await waitForEventSource();
      const firstInstance = requireLatestEventSource();
      firstInstance.triggerOpen();
      await waitFor(() => expect(result.current.isConnected).toBe(true), {
        timeout: 500,
      });

      // Simulate connection dying
      firstInstance.readyState = firstInstance.CLOSED;

      // Simulate network coming back online
      window.dispatchEvent(new Event("online"));

      // Should create a new EventSource
      await waitFor(() => expect(eventSourceInstances.length).toBe(2), {
        timeout: 500,
      });
      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.status).toBe("idle");
      });

      const secondInstance = requireLatestEventSource();
      secondInstance.triggerOpen();

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 500 },
      );
    });

    it("should not reconnect on visibilitychange if already connected", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderHook(() => useSSE("/api/sse/events"));

      await waitForEventSource();
      const firstInstance = requireLatestEventSource();
      firstInstance.triggerOpen();

      // readyState is OPEN (1), so visibility change should be a no-op
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      // Should NOT create a new EventSource
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(eventSourceInstances.length).toBe(1);
    });

    it("should clean up visibility and online listeners on unmount", async () => {
      const removeDocSpy = vi.spyOn(document, "removeEventListener");
      const removeWinSpy = vi.spyOn(window, "removeEventListener");

      const { unmount } = renderHook(() => useSSE("/api/sse/events"));

      await waitForEventSource();
      mockEventSource?.triggerOpen();

      unmount();

      expect(removeDocSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );
      expect(removeWinSpy).toHaveBeenCalledWith("online", expect.any(Function));
    });
  });
});
