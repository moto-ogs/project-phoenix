import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Counts requests on the real SWR: the readers of a page share one.
vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1" }, expires: "2099-01-01" },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => "school-a",
}));

import { resetSWRScope } from "~/lib/swr/scope";
import { usePushPublicKey } from "./use-push-public-key";

const VAPID_PUBLIC_KEY =
  "BAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The three always-mounted readers of a page: sync, setup, settings card. */
function usePageReaders() {
  return [
    usePushPublicKey("tenant"),
    usePushPublicKey("tenant"),
    usePushPublicKey("tenant"),
  ];
}

describe("usePushPublicKey", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetSWRScope({ revalidate: false });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("loads the key once for every reader of a page", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(answer({ data: { public_key: VAPID_PUBLIC_KEY } })),
    );

    const { result } = renderHook(usePageReaders);
    await waitFor(() =>
      expect(result.current.map((read) => read.state)).toEqual([
        "ready",
        "ready",
        "ready",
      ]),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/notifications/push/public-key",
    );
    expect(result.current[0]?.require()).toHaveLength(65);
    // A click takes the key at hand.
    await expect(result.current[1]?.load()).resolves.toHaveLength(65);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the answer of a server without Web Push and does not ask again", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(answer({ code: "general.input" }, 404)),
    );

    const first = renderHook(usePageReaders);
    await waitFor(() =>
      expect(first.result.current.map((read) => read.state)).toEqual([
        "missing",
        "missing",
        "missing",
      ]),
    );
    expect(() => first.result.current[0]?.require()).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    first.unmount();

    // The next page of the same visit mounts its readers again.
    const next = renderHook(usePageReaders);
    expect(next.result.current[0]?.state).toBe("missing");
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed read and reads once more for a click", async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(answer({ code: "general.server" }, 500)),
    );

    const { result } = renderHook(() => usePushPublicKey("parent"));
    await waitFor(() => expect(result.current.state).toBe("failed"));
    expect(() => result.current.require()).toThrow(
      expect.objectContaining({ status: 500 }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(() =>
      Promise.resolve(answer({ data: { public_key: VAPID_PUBLIC_KEY } })),
    );
    let loaded: Uint8Array | undefined;
    await act(async () => {
      loaded = await result.current.load();
    });
    expect(loaded).toHaveLength(65);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/parent/me/push/public-key");
    await waitFor(() => expect(result.current.state).toBe("ready"));
  });
});
