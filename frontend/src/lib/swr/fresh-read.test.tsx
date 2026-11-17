import { startTransition, Suspense, useState } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
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

import { ApiError } from "~/lib/api-error";
import { useInvalidateMatching } from "./hooks";
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
  it("keeps the committed reader usable when another opening suspends", async () => {
    const blocked = deferred<void>();
    const fetcher = vi.fn(async () => "confirmed");
    function Reader({ resourceKey }: Readonly<{ resourceKey: string }>) {
      const read = useFreshSWR(resourceKey, fetcher);
      if (resourceKey === "fresh-suspended-b") throw blocked.promise;
      return (
        <>
          <p>{read.data ?? "Loading"}</p>
          <button onClick={() => void read.mutate()}>Reload</button>
        </>
      );
    }
    function Surface() {
      const [resourceKey, setResourceKey] = useState("fresh-suspended-a");
      return (
        <>
          <button
            onClick={() =>
              startTransition(() => setResourceKey("fresh-suspended-b"))
            }
          >
            Open next
          </button>
          <Suspense fallback={<p>Opening next</p>}>
            <Reader resourceKey={resourceKey} />
          </Suspense>
        </>
      );
    }
    render(<Surface />);
    await screen.findByText("confirmed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Open next" }));
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it.each([false, true])(
    "keeps this opening's confirmed data while refreshing (failure=%s)",
    async (failure) => {
      const next = deferred<string>();
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce("confirmed")
        .mockReturnValueOnce(next.promise);
      const { result } = renderHook(() =>
        useFreshSWR("fresh-confirmed-refresh", fetcher, {
          shouldRetryOnError: false,
        }),
      );
      await waitFor(() => expect(result.current.data).toBe("confirmed"));
      let refresh!: Promise<unknown>;
      act(() => {
        refresh = result.current.mutate();
      });
      expect(result.current.isValidating).toBe(true);
      expect(result.current.data).toBe("confirmed");
      expect(result.current.fresh).toBe(true);
      expect(result.current.isLoading).toBe(false);
      const error = new Error("offline");
      await act(async () => {
        if (failure) next.reject(error);
        else next.resolve("updated");
        await refresh;
      });
      expect(result.current.data).toBe(failure ? "confirmed" : "updated");
      expect(result.current.error).toBe(failure ? error : undefined);
      expect(result.current.fresh).toBe(true);
    },
  );

  it.each([401, 403])(
    "does not retain confirmed data after access is refused (%s)",
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce("confirmed")
        .mockRejectedValueOnce(new ApiError("refused", status))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce("authorized");
      const { result } = renderHook(() =>
        useFreshSWR("fresh-refused-refresh", fetcher, {
          shouldRetryOnError: false,
        }),
      );
      await waitFor(() => expect(result.current.data).toBe("confirmed"));
      await act(async () => {
        await result.current.mutate();
      });
      expect(result.current.error).toBeDefined();
      expect(result.current.data).toBeUndefined();
      await act(async () => {
        await result.current.mutate();
      });
      expect(result.current.data).toBeUndefined();
      await act(async () => {
        await result.current.mutate();
      });
      expect(result.current.data).toBe("authorized");
    },
  );

  it("withdraws confirmed data when its generation is cleared", async () => {
    const next = deferred<string>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("confirmed")
      .mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => ({
      read: useFreshSWR("fresh-clear", fetcher),
      invalidate: useInvalidateMatching(),
    }));
    await waitFor(() => expect(result.current.read.data).toBe("confirmed"));
    await act(async () => {
      await result.current.invalidate((key) => key === "fresh-clear", {
        clear: true,
      });
    });
    expect(result.current.read.data).toBeUndefined();
    expect(result.current.read.fresh).toBe(false);
    await act(async () => {
      next.resolve("new generation");
    });
    await waitFor(() =>
      expect(result.current.read.data).toBe("new generation"),
    );
  });

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

  it.each([false, true])(
    "starts a new request if an earlier opening is still pending (remount=%s)",
    async (remount) => {
      const old = deferred<string>();
      const current = deferred<string>();
      const fetcher = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const initialProps: { open: boolean } = { open: true };
      const first = renderHook(
        ({ open }: { open: boolean }) =>
          useFreshSWR(open ? "fresh-pending" : null, fetcher),
        { initialProps },
      );
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      let active = first;
      if (remount) {
        first.unmount();
        active = renderHook(
          ({ open }: { open: boolean }) =>
            useFreshSWR(open ? "fresh-pending" : null, fetcher),
          { initialProps },
        );
      } else {
        first.rerender({ open: false });
        first.rerender({ open: true });
      }
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      await act(async () => old.resolve("old"));
      expect(active.result.current.data).toBeUndefined();
      expect(active.result.current.fresh).toBe(false);
      await act(async () => current.resolve("current"));
      await waitFor(() => expect(active.result.current.data).toBe("current"));
    },
  );

  it("keeps caller pauses and starts its own request when resumed", async () => {
    const fetcher = vi.fn(async () => "fresh");
    const { result, rerender } = renderHook(
      ({ paused }) =>
        useFreshSWR("fresh-paused", fetcher, { isPaused: () => paused }),
      { initialProps: { paused: true } },
    );
    expect(result.current.fresh).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    rerender({ paused: false });
    await waitFor(() => expect(result.current.data).toBe("fresh"));
    expect(fetcher).toHaveBeenCalledTimes(1);
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
