import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The contract on the real SWR: what a reader shows after a refused read.
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

import { useSWRAuth } from "./hooks";
import { resetSWRScope } from "./scope";

const options = { shouldRetryOnError: false, dedupingInterval: 0 };
const failure = (status: number) =>
  Object.assign(new Error(`status ${status}`), { status });

beforeEach(() => {
  resetSWRScope({ revalidate: false });
});

describe("useSWRAuth after an access refusal", () => {
  it("withdraws shown data until a read succeeds again", async () => {
    const answers: (() => Promise<string>)[] = [
      () => Promise.resolve("Protokoll"),
      () => Promise.reject(failure(403)),
      () => Promise.reject(failure(500)),
      () => Promise.resolve("Protokoll neu"),
    ];
    const fetcher = vi.fn(() => answers[fetcher.mock.calls.length - 1]!());
    const { result } = renderHook(() =>
      useSWRAuth("refusal-read-1", fetcher, options),
    );
    await waitFor(() => expect(result.current.data).toBe("Protokoll"));

    await act(async () => void (await result.current.mutate()));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBeUndefined();

    // A later server error must not bring the refused data back.
    await act(async () => void (await result.current.mutate()));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeDefined();

    const other = renderHook(() =>
      useSWRAuth("refusal-read-1", fetcher, {
        ...options,
        revalidateOnMount: false,
      }),
    );
    expect(other.result.current.data).toBeUndefined();
    other.unmount();

    await act(async () => void (await result.current.mutate()));
    await waitFor(() => expect(result.current.data).toBe("Protokoll neu"));
    expect(result.current.error).toBeUndefined();
  });

  it("keeps shown data when a refresh fails without a refusal", async () => {
    const answers: (() => Promise<string>)[] = [
      () => Promise.resolve("Liste"),
      () => Promise.reject(failure(500)),
    ];
    const fetcher = vi.fn(() => answers[fetcher.mock.calls.length - 1]!());
    const { result } = renderHook(() =>
      useSWRAuth("refusal-read-2", fetcher, options),
    );
    await waitFor(() => expect(result.current.data).toBe("Liste"));

    await act(async () => void (await result.current.mutate()));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBe("Liste");
  });

  it("lifts the refusal when the account changes", async () => {
    const answers: (() => Promise<string>)[] = [
      () => Promise.reject(failure(403)),
      () => Promise.reject(failure(500)),
    ];
    const fetcher = vi.fn(() => answers[fetcher.mock.calls.length - 1]!());
    const { result } = renderHook(() =>
      useSWRAuth("refusal-read-3", fetcher, options),
    );
    await waitFor(() => expect(result.current.error).toBeDefined());

    act(() => resetSWRScope({ revalidate: false }));
    await act(async () => void (await result.current.mutate()));
    await waitFor(() =>
      expect((result.current.error as { status?: number })?.status).toBe(500),
    );
  });
});
