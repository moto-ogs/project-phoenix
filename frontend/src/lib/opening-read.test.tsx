import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The opening on the real SWR cache, with its default deduping and retries.
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

import { openingReadOptions, useOpeningRead } from "./opening-read";
import { useSWRAuth } from "./swr/hooks";
import { resetSWRScope } from "./swr/scope";

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

/** The form surface: the shared read plus its opening. */
function useForm(
  key: string,
  opening: number | null,
  fetcher: () => Promise<string>,
) {
  const read = useSWRAuth(key, fetcher, openingReadOptions);
  return useOpeningRead(opening, read, fetcher);
}

beforeEach(() => {
  resetSWRScope({ revalidate: false });
});

describe("useOpeningRead", () => {
  it("reads at every opening, also right after a read of the key, and then holds it", async () => {
    const fetcher = answering("Liste", "Formular", "Hintergrund");
    // Another view read the key a moment ago, well inside the deduping
    // interval.
    const list = renderHook(() => useSWRAuth("opening-1", fetcher));
    await waitFor(() => expect(list.result.current.data).toBe("Liste"));

    const form = renderHook(() => useForm("opening-1", 1, fetcher));
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
  });

  it("reads again when the surface opens again", async () => {
    const fetcher = answering("Erste", "Zweite");
    const form = renderHook(
      ({ opening }: { opening: number | null }) =>
        useForm("opening-2", opening, fetcher),
      { initialProps: { opening: 1 as number | null } },
    );
    await waitFor(() => expect(form.result.current.data).toBe("Erste"));

    form.rerender({ opening: null });
    form.rerender({ opening: 2 });
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
      const opened = useForm("opening-3", 1, fetcher);
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

  it("holds the answer of a reload after a refusal", async () => {
    const fetcher = answering("Formular", "Aktuell");
    const form = renderHook(() => useForm("opening-4", 1, fetcher));
    await waitFor(() => expect(form.result.current.data).toBe("Formular"));

    await act(async () => {
      await expect(form.result.current.reload()).resolves.toBe("Aktuell");
    });
    expect(form.result.current.data).toBe("Aktuell");
  });
});
