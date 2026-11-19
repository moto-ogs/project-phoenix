import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Logger } from "~/lib/logger";
import { GET, HEAD } from "~/app/api/health/route";
import { isDraining, onDrain, startDrain } from "./process-drain.server";
import { proxySSEStream } from "./sse-proxy.server";

// The drain is process-wide and one-way, so this file owns it: every test
// before startDrain() sees a serving process, every test after a draining one.

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: () => "http://localhost:8080",
}));

it("ends an open event stream cleanly and fails the health check once the replica drains", async () => {
  let upstreamSignal: AbortSignal | undefined;
  global.fetch = vi.fn((_url: string, init?: RequestInit) => {
    upstreamSignal = init?.signal ?? undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
      },
    });
    return Promise.resolve(
      new Response(body, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  }) as typeof fetch;
  const logger = { error: vi.fn(), debug: vi.fn() } as unknown as Logger;
  const lateListener = vi.fn();

  expect((await GET()).status).toBe(200);
  const response = await proxySSEStream(
    new NextRequest("http://localhost:3000/api/sse/events"),
    { token: "test-token", upstreamPath: "/api/sse/events", logger },
  );
  const reader = response.body!.getReader();
  expect((await reader.read()).done).toBe(false);
  expect(isDraining()).toBe(false);

  startDrain();

  // The heartbeat already read; the next read is the clean end of stream.
  expect(await reader.read()).toEqual({ done: true, value: undefined });
  expect(upstreamSignal?.aborted).toBe(true);
  expect(isDraining()).toBe(true);
  const draining = await GET();
  expect(draining.status).toBe(503);
  expect(draining.headers.get("Connection")).toBe("close");
  expect((await HEAD()).status).toBe(503);
  onDrain(lateListener);
  expect(lateListener).toHaveBeenCalledOnce();
  expect(logger.error).not.toHaveBeenCalled();
});
