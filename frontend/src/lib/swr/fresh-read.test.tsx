import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The contract on the real SWR: what a second opening shows.
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

import { useFreshSWR } from "./hooks";
import { resetSWRScope } from "./scope";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetSWRScope({ revalidate: false });
});

describe("useFreshSWR", () => {
  it("hides the answer of an earlier opening until this one has its own", async () => {
    const answers = [deferred<string>(), deferred<string>()];
    const fetcher = vi.fn(
      () => answers[fetcher.mock.calls.length - 1]!.promise,
    );

    const first = renderHook(() => useFreshSWR("fresh-preview-1", fetcher));
    expect(first.result.current.data).toBeUndefined();
    expect(first.result.current.isLoading).toBe(true);
    await act(async () => answers[0]!.resolve("alt"));
    await waitFor(() => expect(first.result.current.data).toBe("alt"));
    expect(first.result.current.fresh).toBe(true);
    first.unmount();

    const second = renderHook(() => useFreshSWR("fresh-preview-1", fetcher));
    expect(second.result.current.data).toBeUndefined();
    expect(second.result.current.isLoading).toBe(true);
    await act(async () => answers[1]!.resolve("neu"));
    await waitFor(() => expect(second.result.current.data).toBe("neu"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("starts a new opening when the key comes back after null", async () => {
    const answers = [deferred<string>(), deferred<string>()];
    const fetcher = vi.fn(
      () => answers[fetcher.mock.calls.length - 1]!.promise,
    );

    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useFreshSWR(open ? "fresh-preview-2" : null, fetcher),
      { initialProps: { open: true } },
    );
    await act(async () => answers[0]!.resolve("alt"));
    await waitFor(() => expect(result.current.data).toBe("alt"));

    rerender({ open: false });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);

    rerender({ open: true });
    expect(result.current.data).toBeUndefined();
    await act(async () => answers[1]!.resolve("neu"));
    await waitFor(() => expect(result.current.data).toBe("neu"));
  });

  it("never exposes A as fresh after A to B to A before B settles", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const again = deferred<string>();
    const fetchA = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValue(again.promise);
    const seen: { fresh: boolean; data: string | undefined }[] = [];
    const { result, rerender } = renderHook(
      ({ key }) => {
        const read = useFreshSWR(
          key,
          key === "fresh-a" ? fetchA : () => b.promise,
        );
        seen.push({ fresh: read.fresh, data: read.data });
        return read;
      },
      { initialProps: { key: "fresh-a" } },
    );
    await act(async () => a.resolve("old A"));
    await waitFor(() => expect(result.current.data).toBe("old A"));
    rerender({ key: "fresh-b" });
    seen.length = 0;
    rerender({ key: "fresh-a" });
    expect(seen.every((read) => !read.fresh && read.data === undefined)).toBe(
      true,
    );
    await act(async () => {
      b.resolve("B");
      again.resolve("fresh A");
    });
    await waitFor(() => expect(result.current.data).toBe("fresh A"));
  });

  it("ends loading with the error when the opening's request fails", async () => {
    const answer = deferred<string>();
    const { result } = renderHook(() =>
      useFreshSWR("fresh-preview-3", () => answer.promise, {
        shouldRetryOnError: false,
      }),
    );
    await act(async () => answer.reject(new Error("kaputt")));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBeUndefined();
    expect(result.current.fresh).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("shows no earlier answer when this opening's request fails", async () => {
    const answers = [deferred<string>(), deferred<string>()];
    const fetcher = vi.fn(
      () => answers[fetcher.mock.calls.length - 1]!.promise,
    );
    const options = { shouldRetryOnError: false };

    const first = renderHook(() =>
      useFreshSWR("fresh-preview-4", fetcher, options),
    );
    await act(async () => answers[0]!.resolve("alt"));
    await waitFor(() => expect(first.result.current.data).toBe("alt"));
    first.unmount();

    const second = renderHook(() =>
      useFreshSWR("fresh-preview-4", fetcher, options),
    );
    // The reader takes the failure; this handle of the test must not count
    // as unhandled.
    answers[1]!.promise.catch(() => undefined);
    await act(async () => answers[1]!.reject(new Error("kaputt")));
    await waitFor(() => expect(second.result.current.error).toBeDefined());
    expect(second.result.current.data).toBeUndefined();
  });
});
