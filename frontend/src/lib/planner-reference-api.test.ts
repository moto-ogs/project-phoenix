import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPlannerGroups, fetchPlannerRooms } from "./planner-reference-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("planner reference lists", () => {
  it("unwraps the envelope of a successful answer", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "1", name: "Mensa" }] }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    await expect(fetchPlannerRooms()).resolves.toEqual([
      { id: "1", name: "Mensa" },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms?page=1&page_size=1000",
      { credentials: "include" },
    );
  });

  it("loads every room-reference page", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "1", name: "Mensa" }],
            pagination: { total_pages: 2 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "2", name: "Werkraum" }],
            pagination: { total_pages: 2 },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    await expect(fetchPlannerRooms()).resolves.toEqual([
      { id: "1", name: "Mensa" },
      { id: "2", name: "Werkraum" },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/rooms?page=2&page_size=1000",
      { credentials: "include" },
    );
  });

  it("asks for the next page after a full page without pagination", async () => {
    // The catalog proxy hands on the list without its pagination (#7563).
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({
      id: String(index + 1),
      name: `Raum ${index + 1}`,
    }));
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: fullPage }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: [{ id: "1001", name: "Aula" }],
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    const rooms = await fetchPlannerRooms();

    expect(rooms).toHaveLength(1001);
    expect(rooms.at(-1)).toEqual({ id: "1001", name: "Aula" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps code and request ID of a failed answer", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          error: "boom",
          code: "general.server",
          instance: "req-3",
        }),
        { status: 500 },
      ),
    ) as unknown as typeof fetch;

    await expect(fetchPlannerGroups()).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      code: "general.server",
      requestId: "req-3",
    });
  });

  it("turns a request that never reached the API into general.unavailable", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError("Failed to fetch"),
      ) as unknown as typeof fetch;

    await expect(fetchPlannerRooms()).rejects.toMatchObject({
      code: "general.unavailable",
    });
  });
});
