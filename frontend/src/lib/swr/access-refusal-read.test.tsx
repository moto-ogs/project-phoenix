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

import { useLayoutEffect } from "react";
import {
  liftRefusal,
  refusalFor,
  shownDataRefusalCount,
} from "~/lib/access-refusal";
import { useSWRAuth, useSWRCacheKey, useTenantMutate } from "./hooks";
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

  it("withdraws the data in a reader that did not start the refused read", async () => {
    let refuse = false;
    const fetcher = vi.fn(() =>
      refuse ? Promise.reject(failure(403)) : Promise.resolve("Protokoll"),
    );
    const watching = renderHook(() =>
      useSWRAuth("refusal-read-4", fetcher, options),
    );
    await waitFor(() => expect(watching.result.current.data).toBe("Protokoll"));
    const starting = renderHook(() =>
      useSWRAuth("refusal-read-4", fetcher, {
        ...options,
        revalidateOnMount: false,
      }),
    );

    refuse = true;
    await act(async () => void (await starting.result.current.mutate()));
    await waitFor(() => expect(watching.result.current.error).toBeDefined());
    expect(watching.result.current.data).toBeUndefined();
  });

  it("counts no refusal of shown data when a refused key is written again", async () => {
    const answers: (() => Promise<string>)[] = [
      () => Promise.resolve("Protokoll"),
      () => Promise.reject(failure(403)),
    ];
    const fetcher = vi.fn(() => answers[fetcher.mock.calls.length - 1]!());
    const { result } = renderHook(() => ({
      // Without previous data the reader sees the key empty in between.
      read: useSWRAuth("refusal-read-5", fetcher, {
        ...options,
        keepPreviousData: false,
      }),
      write: useTenantMutate(),
    }));
    await waitFor(() => expect(result.current.read.data).toBe("Protokoll"));
    await act(async () => void (await result.current.read.mutate()));
    await waitFor(() => expect(result.current.read.error).toBeDefined());
    const counted = shownDataRefusalCount();

    // Another view writes the answer it still holds after its own save.
    await act(
      async () =>
        void (await result.current.write("refusal-read-5", "Protokoll alt", {
          revalidate: false,
        })),
    );
    expect(result.current.read.data).toBeUndefined();
    expect(result.current.read.error).toBeDefined();
    expect(shownDataRefusalCount()).toBe(counted);
  });

  it("keeps the answer of a read that succeeded before the withdrawal ran", async () => {
    let refuse = false;
    const fetcher = vi.fn(() =>
      refuse ? Promise.reject(failure(403)) : Promise.resolve("Protokoll"),
    );
    // Layout effects run before the reader's withdrawal: the next answer
    // arrives exactly in between.
    let arrive: ((key: string) => void) | null = null;
    const { result } = renderHook(() => {
      const read = useSWRAuth("refusal-read-6", fetcher, options);
      const key = useSWRCacheKey()("refusal-read-6");
      const refused = read.error !== undefined;
      useLayoutEffect(() => {
        if (refused && key !== null) arrive?.(key);
      }, [refused, key]);
      return { read, write: useTenantMutate() };
    });
    await waitFor(() => expect(result.current.read.data).toBe("Protokoll"));

    arrive = (key) => {
      arrive = null;
      liftRefusal(key);
      void result.current.write("refusal-read-6", "Protokoll neu", {
        revalidate: false,
      });
    };
    refuse = true;
    await act(async () => void (await result.current.read.mutate()));
    await waitFor(() => expect(result.current.read.data).toBe("Protokoll neu"));
    expect(result.current.read.error).toBeUndefined();
    const key = renderHook(() => useSWRCacheKey()("refusal-read-6"));
    expect(refusalFor(key.result.current!)).toBeUndefined();
  });
});
