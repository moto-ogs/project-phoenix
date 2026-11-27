import { Activity, startTransition, Suspense, useState } from "react";
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
import { useInvalidateMatching, useOpeningRead, useSWRAuth } from "./hooks";
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

/** An audited read: nothing shows until the opening's own read answered. */
function useAudited<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  isPaused?: () => boolean,
) {
  return useOpeningRead(key, fetcher, { showCached: false, isPaused });
}

/** A fetcher that answers in order; `fail` entries reject. */
function answering(...answers: string[]) {
  const fetcher = vi.fn(() => {
    const answer = answers[fetcher.mock.calls.length - 1] ?? "unexpected";
    return answer.startsWith("fail")
      ? Promise.reject(new Error(answer))
      : Promise.resolve(answer);
  });
  return fetcher;
}

describe("useOpeningRead (showCached: false)", () => {
  it.each([false, true])(
    "hides the previous answer on Activity reveal (refused=%s)",
    async (refused) => {
      const reopened = deferred<string>();
      const fetcher = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("previous contract")
        .mockReturnValueOnce(reopened.promise);
      function Reader() {
        const read = useAudited("fresh-activity", fetcher);
        return (
          <p>
            {read.error ? "Access refused" : (read.data ?? "Checking access")}
          </p>
        );
      }
      const { rerender } = render(
        <Activity mode="visible">
          <Reader />
        </Activity>,
      );
      expect(await screen.findByText("previous contract")).toBeVisible();
      rerender(
        <Activity mode="hidden">
          <Reader />
        </Activity>,
      );
      rerender(
        <Activity mode="visible">
          <Reader />
        </Activity>,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      // The visible opening waits for its own authorization.
      expect(screen.getByText("Checking access")).toBeVisible();
      expect(screen.queryByText("previous contract")).not.toBeInTheDocument();
      await act(async () => {
        if (refused) reopened.reject(new ApiError("refused", 403));
        else reopened.resolve("current contract");
      });
      expect(
        await screen.findByText(
          refused ? "Access refused" : "current contract",
        ),
      ).toBeVisible();
    },
  );

  it("keeps the committed reader usable when another opening suspends", async () => {
    const blocked = deferred<void>();
    const fetcher = vi.fn(async () => "confirmed");
    function Reader({ resourceKey }: Readonly<{ resourceKey: string }>) {
      const read = useAudited(resourceKey, fetcher);
      if (resourceKey === "fresh-suspended-b") throw blocked.promise;
      return (
        <>
          <p>{read.data ?? "Loading"}</p>
          <button onClick={() => void read.reload()}>Reload</button>
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
        useAudited("fresh-confirmed-refresh", fetcher),
      );
      await waitFor(() => expect(result.current.data).toBe("confirmed"));
      let refresh!: Promise<unknown>;
      act(() => {
        refresh = result.current.mutate();
      });
      expect(result.current.isValidating).toBe(true);
      expect(result.current.data).toBe("confirmed");
      expect(result.current.settled).toBe(true);
      expect(result.current.isLoading).toBe(false);
      const error = new Error("offline");
      await act(async () => {
        if (failure) next.reject(error);
        else next.resolve("updated");
        await refresh;
      });
      expect(result.current.data).toBe(failure ? "confirmed" : "updated");
      expect(result.current.error).toBe(failure ? error : undefined);
      expect(result.current.settled).toBe(true);
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
        useAudited("fresh-refused-refresh", fetcher),
      );
      await waitFor(() => expect(result.current.data).toBe("confirmed"));
      await act(async () => {
        await expect(result.current.reload()).rejects.toBeDefined();
      });
      expect(result.current.error).toBeDefined();
      expect(result.current.data).toBeUndefined();
      await act(async () => {
        await expect(result.current.reload()).rejects.toBeDefined();
      });
      expect(result.current.data).toBeUndefined();
      await act(async () => {
        await expect(result.current.reload()).resolves.toBe("authorized");
      });
      expect(result.current.data).toBe("authorized");
    },
  );

  it.each(["reload", "mutate"] as const)(
    "discards a late %s instead of replacing another opening's answer",
    async (action) => {
      const old = deferred<string>();
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce("First opening")
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce("Second opening");
      const { result, rerender } = renderHook(
        ({ resourceKey }) => useAudited(resourceKey, fetcher),
        { initialProps: { resourceKey: "late-reload-first" } },
      );
      await waitFor(() => expect(result.current.data).toBe("First opening"));

      let pending!: Promise<unknown>;
      act(() => {
        pending = result.current[action]().catch((error: unknown) => error);
      });
      rerender({ resourceKey: "late-reload-second" });
      await waitFor(() => expect(result.current.data).toBe("Second opening"));

      await act(async () => {
        old.resolve("Outdated first opening");
        const value = await pending;
        if (action === "reload")
          expect(value).toMatchObject({ name: "DiscardedAnswer" });
        else expect(value).toBeUndefined();
      });
      expect(result.current.data).toBe("Second opening");
      expect(result.current.isLoading).toBe(false);
    },
  );

  it("ignores a late refusal after reopening the same filter", async () => {
    const old = deferred<string>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce("Other filter")
      .mockResolvedValueOnce("Reopened filter");
    const onError = vi.fn();
    const { result, rerender } = renderHook(
      ({ resourceKey }) =>
        useOpeningRead(resourceKey, fetcher, { showCached: false, onError }),
      { initialProps: { resourceKey: "late-refusal-first" } },
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    rerender({ resourceKey: "late-refusal-second" });
    await waitFor(() => expect(result.current.data).toBe("Other filter"));
    rerender({ resourceKey: "late-refusal-first" });
    await waitFor(() => expect(result.current.data).toBe("Reopened filter"));

    await act(async () => {
      old.reject(new ApiError("refused", 403));
      await old.promise.catch(() => undefined);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toBe("Reopened filter");
  });

  it("withdraws confirmed data when its generation is cleared", async () => {
    const next = deferred<string>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("confirmed")
      .mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => ({
      read: useAudited("fresh-clear", fetcher),
      invalidate: useInvalidateMatching(),
    }));
    await waitFor(() => expect(result.current.read.data).toBe("confirmed"));
    await act(async () => {
      await result.current.invalidate((key) => key === "fresh-clear", {
        clear: true,
      });
    });
    expect(result.current.read.data).toBeUndefined();
    expect(result.current.read.settled).toBe(false);
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

    const first = renderHook(() => useAudited("fresh-preview-1", fetcher));
    expect(first.result.current.data).toBeUndefined();
    expect(first.result.current.isLoading).toBe(true);
    await act(async () => answers[0]!.resolve("alt"));
    await waitFor(() => expect(first.result.current.data).toBe("alt"));
    expect(first.result.current.settled).toBe(true);
    first.unmount();

    const second = renderHook(() => useAudited("fresh-preview-1", fetcher));
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
        useAudited(open ? "fresh-preview-2" : null, fetcher),
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
        const read = useAudited(
          key,
          key === "fresh-a" ? fetchA : () => b.promise,
        );
        seen.push({ fresh: read.settled, data: read.data });
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
          useAudited(open ? "fresh-pending" : null, fetcher),
        { initialProps },
      );
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      let active = first;
      if (remount) {
        first.unmount();
        active = renderHook(
          ({ open }: { open: boolean }) =>
            useAudited(open ? "fresh-pending" : null, fetcher),
          { initialProps },
        );
      } else {
        first.rerender({ open: false });
        first.rerender({ open: true });
      }
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      await act(async () => old.resolve("old"));
      expect(active.result.current.data).toBeUndefined();
      expect(active.result.current.settled).toBe(false);
      await act(async () => current.resolve("current"));
      await waitFor(() => expect(active.result.current.data).toBe("current"));
    },
  );

  it("keeps caller pauses and starts its own request when resumed", async () => {
    const fetcher = vi.fn(async () => "fresh");
    const { result, rerender } = renderHook(
      ({ paused }) => useAudited("fresh-paused", fetcher, () => paused),
      { initialProps: { paused: true } },
    );
    expect(result.current.settled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    rerender({ paused: false });
    await waitFor(() => expect(result.current.data).toBe("fresh"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ends loading with the error when the opening's request fails", async () => {
    const answer = deferred<string>();
    const { result } = renderHook(() =>
      useAudited("fresh-preview-3", () => answer.promise),
    );
    await act(async () => answer.reject(new Error("kaputt")));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBeUndefined();
    expect(result.current.settled).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("shows no earlier answer when this opening's request fails", async () => {
    const answers = [deferred<string>(), deferred<string>()];
    const fetcher = vi.fn(
      () => answers[fetcher.mock.calls.length - 1]!.promise,
    );
    const first = renderHook(() => useAudited("fresh-preview-4", fetcher));
    await act(async () => answers[0]!.resolve("alt"));
    await waitFor(() => expect(first.result.current.data).toBe("alt"));
    first.unmount();

    const second = renderHook(() => useAudited("fresh-preview-4", fetcher));
    // The reader takes the failure; this handle of the test must not count
    // as unhandled.
    answers[1]!.promise.catch(() => undefined);
    await act(async () => answers[1]!.reject(new Error("kaputt")));
    await waitFor(() => expect(second.result.current.error).toBeDefined());
    expect(second.result.current.data).toBeUndefined();
  });

  it("reads again on an invalidation of the key and shows that answer", async () => {
    const fetcher = answering("Erste", "Zweite");
    const { result } = renderHook(() => ({
      read: useAudited("fresh-invalidated", fetcher),
      invalidate: useInvalidateMatching(),
    }));
    await waitFor(() => expect(result.current.read.data).toBe("Erste"));
    await act(async () => {
      await result.current.invalidate((key) => key === "fresh-invalidated");
    });
    await waitFor(() => expect(result.current.read.data).toBe("Zweite"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

/** The form surface: one opening of the shared read. */
function useForm(key: string | null, fetcher: () => Promise<string>) {
  return useOpeningRead(key, fetcher, { showCached: true });
}

describe("useOpeningRead (showCached: true)", () => {
  it("reads at every opening, also right after a read of the key, and then holds it", async () => {
    const fetcher = answering("Liste", "Formular", "Hintergrund");
    // Another view read the key a moment ago, well inside the deduping
    // interval.
    const list = renderHook(() => useSWRAuth("opening-1", fetcher));
    await waitFor(() => expect(list.result.current.data).toBe("Liste"));

    const form = renderHook(() => useForm("opening-1", fetcher));
    expect(form.result.current).toMatchObject({
      data: "Liste",
      settled: false,
    });
    await waitFor(() => expect(form.result.current.settled).toBe(true));
    expect(form.result.current.data).toBe("Formular");
    expect(fetcher).toHaveBeenCalledTimes(2);

    // A later background read changes the cache, not the opened form.
    await act(async () => void (await list.result.current.mutate()));
    expect(list.result.current.data).toBe("Hintergrund");
    expect(form.result.current.data).toBe("Formular");
    expect(form.result.current.latest).toBe("Hintergrund");
  });

  it("keeps its answer when an invalidation reads the key again", async () => {
    const fetcher = answering("Formular", "Neuer");
    const { result } = renderHook(() => ({
      form: useForm("opening-6", fetcher),
      invalidate: useInvalidateMatching(),
    }));
    await waitFor(() => expect(result.current.form.data).toBe("Formular"));
    await act(async () => {
      await result.current.invalidate((key) => key === "opening-6");
    });
    await waitFor(() => expect(result.current.form.latest).toBe("Neuer"));
    expect(result.current.form.data).toBe("Formular");
  });

  it("reads again when the surface opens again", async () => {
    const fetcher = answering("Erste", "Zweite");
    const form = renderHook(
      ({ open }: { open: boolean }) =>
        useForm(open ? "opening-2" : null, fetcher),
      { initialProps: { open: true } },
    );
    await waitFor(() => expect(form.result.current.data).toBe("Erste"));

    form.rerender({ open: false });
    form.rerender({ open: true });
    expect(form.result.current).toMatchObject({
      data: "Erste",
      settled: false,
    });
    await waitFor(() => expect(form.result.current.data).toBe("Zweite"));
    expect(form.result.current.settled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed first read failed while retries fail, without showing the cached form", async () => {
    const fetcher = answering("Alt", "fail-1", "fail-2", "Neu");
    const list = renderHook(() =>
      useSWRAuth("opening-3", fetcher, { shouldRetryOnError: false }),
    );
    await waitFor(() => expect(list.result.current.data).toBe("Alt"));

    const shown: (string | undefined)[] = [];
    const form = renderHook(() => {
      const opened = useForm("opening-3", fetcher);
      shown.push(opened.data);
      return opened;
    });
    await waitFor(() => expect(form.result.current.error).toBeDefined());
    expect(form.result.current.data).toBeUndefined();
    shown.length = 0;

    act(() => form.result.current.retry());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(form.result.current.error).toMatchObject({ message: "fail-2" }),
    );
    expect(shown.every((data) => data === undefined)).toBe(true);

    act(() => form.result.current.retry());
    await waitFor(() => expect(form.result.current.data).toBe("Neu"));
    expect(form.result.current.error).toBeUndefined();
  });

  it("holds the answer of a reload, and a failed reload rejects and changes nothing", async () => {
    const fetcher = answering("Formular", "fail-reload", "Aktuell");
    const form = renderHook(() => useForm("opening-4", fetcher));
    await waitFor(() => expect(form.result.current.data).toBe("Formular"));

    await act(async () => {
      await expect(form.result.current.reload()).rejects.toMatchObject({
        message: "fail-reload",
      });
    });
    expect(form.result.current.data).toBe("Formular");
    expect(form.result.current.error).toBeUndefined();

    await act(async () => {
      await expect(form.result.current.reload()).resolves.toBe("Aktuell");
    });
    expect(form.result.current.data).toBe("Aktuell");
  });

  it("holds a save's answer handed to mutate", async () => {
    const fetcher = answering("Formular");
    const form = renderHook(() => useForm("opening-5", fetcher));
    await waitFor(() => expect(form.result.current.data).toBe("Formular"));
    await act(async () => {
      await form.result.current.mutate("Gespeichert", { revalidate: false });
    });
    expect(form.result.current.data).toBe("Gespeichert");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
