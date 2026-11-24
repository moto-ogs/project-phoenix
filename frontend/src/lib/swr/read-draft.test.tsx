import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The rules of ADR 0311 on the real SWR cache.
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
import { useInvalidateMatching, useSWRAuth } from "./hooks";
import {
  useActionOn,
  useDraftOn,
  useReadDraft,
  type ReadDraftResult,
} from "./read-draft";
import { resetSWRScope } from "./scope";

interface Stored {
  readonly version: string;
  readonly name: string;
}

const changed = () =>
  new ApiError("changed", 409, { code: "general.changed_since_read" });

/** A fetcher that answers in order; an Error entry rejects. */
function answering(...answers: (Stored | Error)[]) {
  const fetcher = vi.fn(() => {
    const answer = answers[fetcher.mock.calls.length - 1];
    if (answer === undefined) return Promise.reject(new Error("unexpected"));
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  });
  return fetcher;
}

function useNameDraft(
  key: string,
  fetcher: () => Promise<Stored>,
  extra: {
    answer?: (saved: Stored, base: Stored) => Stored | undefined;
    rebase?: (draft: string, from: Stored, to: Stored) => string;
  } = {},
) {
  return useReadDraft<Stored, string, string, Stored>({
    key,
    fetcher,
    token: (read) => read.version,
    toDraft: (read) => read.name,
    ...extra,
  });
}

beforeEach(() => {
  resetSWRScope({ revalidate: false });
});

describe("useReadDraft", () => {
  it("refills an untouched draft from a newer read and holds a touched one (rules 1, 2)", async () => {
    const fetcher = answering(
      { version: "1", name: "Anna" },
      { version: "2", name: "Anne" },
      { version: "3", name: "Annika" },
    );
    const { result } = renderHook(() => ({
      draft: useNameDraft("draft-1", fetcher),
      list: useSWRAuth("draft-1", fetcher, { revalidateOnMount: false }),
    }));
    await waitFor(() => expect(result.current.draft.draft).toBe("Anna"));

    // Another view reads the key: the untouched draft follows.
    await act(async () => void (await result.current.list.mutate()));
    await waitFor(() => expect(result.current.draft.draft).toBe("Anne"));
    expect(result.current.draft.token).toBe("2");

    act(() => result.current.draft.setDraft("Hanna"));
    await act(async () => void (await result.current.list.mutate()));
    expect(result.current.draft.draft).toBe("Hanna");
    expect(result.current.draft.token).toBe("2");
    expect(result.current.draft.newer).toBe(true);

    const send = vi.fn(async () => ({ version: "4", name: "Hanna" }));
    await act(async () => {
      await result.current.draft.submit(send);
    });
    expect(send).toHaveBeenCalledWith("2", "Hanna");
  });

  it("shows the stored state after a refusal and sends nothing until then (rules 3, 4)", async () => {
    let answerReload!: (stored: Stored) => void;
    const fetcher = vi
      .fn<() => Promise<Stored>>()
      .mockResolvedValueOnce({ version: "1", name: "Anna" })
      .mockImplementationOnce(
        () =>
          new Promise<Stored>((resolve) => {
            answerReload = resolve;
          }),
      );
    const { result } = renderHook(() => useNameDraft("draft-2", fetcher));
    await waitFor(() => expect(result.current.draft).toBe("Anna"));
    act(() => result.current.setDraft("Hanna"));

    let outcome!: ReadDraftResult<Stored>;
    await act(async () => {
      outcome = await result.current.submit(() => Promise.reject(changed()));
    });
    expect(outcome).toMatchObject({ ok: false, refused: true });
    expect(result.current.canSubmit).toBe(false);
    const second = vi.fn(async () => ({ version: "9", name: "x" }));
    await act(async () => {
      await result.current.submit(second);
    });
    expect(second).not.toHaveBeenCalled();

    await act(async () => {
      answerReload({ version: "2", name: "Anne" });
      if (!outcome.ok) await outcome.reload?.();
    });
    expect(result.current.draft).toBe("Anne");
    expect(result.current.token).toBe("2");
    expect(result.current.touched).toBe(false);
    expect(result.current.canSubmit).toBe(true);
  });

  it("keeps the input on a refusal only with rebase", async () => {
    const fetcher = answering(
      { version: "1", name: "Anna" },
      { version: "2", name: "Anne" },
    );
    const { result } = renderHook(() =>
      useNameDraft("draft-3", fetcher, { rebase: (draft) => draft }),
    );
    await waitFor(() => expect(result.current.draft).toBe("Anna"));
    act(() => result.current.setDraft("Hanna"));
    await act(async () => {
      const outcome = await result.current.submit(() =>
        Promise.reject(changed()),
      );
      if (!outcome.ok) await outcome.reload?.();
    });
    expect(result.current.draft).toBe("Hanna");
    expect(result.current.token).toBe("2");
    expect(result.current.touched).toBe(true);
  });

  it.each([true, false])(
    "sends the token of the save's answer next, never the old one (rule 5, answer=%s)",
    async (withAnswer) => {
      const fetcher = answering(
        { version: "1", name: "Anna" },
        { version: "2", name: "Hanna" },
        { version: "3", name: "Hanna" },
      );
      const { result } = renderHook(() =>
        useNameDraft(`draft-4-${withAnswer}`, fetcher, {
          answer: withAnswer ? (saved) => saved : undefined,
        }),
      );
      await waitFor(() => expect(result.current.draft).toBe("Anna"));
      act(() => result.current.setDraft("Hanna"));
      await act(async () => {
        await result.current.submit(async () => ({
          version: "2",
          name: "Hanna",
        }));
      });
      expect(result.current.token).toBe("2");
      expect(result.current.touched).toBe(false);
      const send = vi.fn(async () => ({ version: "3", name: "Hanna" }));
      await act(async () => {
        await result.current.submit(send);
      });
      expect(send).toHaveBeenCalledWith("2", "Hanna");
      // Each save without an answer reads its result once.
      expect(fetcher).toHaveBeenCalledTimes(withAnswer ? 1 : 3);
    },
  );

  it("reports a failed read after a refusal as a load error (rule 6)", async () => {
    const offline = new ApiError("offline", 503, {
      code: "general.unavailable",
    });
    const fetcher = answering({ version: "1", name: "Anna" }, offline, {
      version: "2",
      name: "Anne",
    });
    const { result } = renderHook(() => useNameDraft("draft-5", fetcher));
    await waitFor(() => expect(result.current.draft).toBe("Anna"));
    let outcome!: ReadDraftResult<Stored>;
    await act(async () => {
      outcome = await result.current.submit(() => Promise.reject(changed()));
    });
    await act(async () => {
      if (!outcome.ok) await expect(outcome.reload?.()).rejects.toBe(offline);
    });
    expect(result.current.status).toBe("loadFailed");
    expect(result.current.error).toBe(offline);
    expect(result.current.canSubmit).toBe(false);

    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.draft).toBe("Anne"));
    expect(result.current.canSubmit).toBe(true);
    expect(result.current.error).toBeUndefined();
  });

  it("does not send on a cached draft whose opening read failed", async () => {
    const fetcher = answering(
      { version: "1", name: "Anna" },
      new Error("offline"),
    );
    const list = renderHook(() =>
      useSWRAuth("draft-6", fetcher, { shouldRetryOnError: false }),
    );
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const { result } = renderHook(() => useNameDraft("draft-6", fetcher));
    await waitFor(() => expect(result.current.status).toBe("loadFailed"));
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.error).toMatchObject({ message: "offline" });
  });

  it("binds the draft to the key's data generation: a clear drops it", async () => {
    let answerNext!: (stored: Stored) => void;
    const fetcher = vi
      .fn<() => Promise<Stored>>()
      .mockResolvedValueOnce({ version: "1", name: "Anna" })
      .mockImplementationOnce(
        () =>
          new Promise<Stored>((resolve) => {
            answerNext = resolve;
          }),
      );
    const { result } = renderHook(() => ({
      draft: useNameDraft("draft-generation", fetcher),
      invalidate: useInvalidateMatching(),
    }));
    await waitFor(() => expect(result.current.draft.draft).toBe("Anna"));
    act(() => result.current.draft.setDraft("Hanna"));

    await act(async () => {
      await result.current.invalidate((key) => key === "draft-generation", {
        clear: true,
      });
    });
    // The old generation's draft is gone and cannot be sent.
    expect(result.current.draft.draft).toBeUndefined();
    expect(result.current.draft.canSubmit).toBe(false);
    const send = vi.fn(async () => ({ version: "9", name: "x" }));
    await act(async () => {
      await result.current.draft.submit(send);
    });
    expect(send).not.toHaveBeenCalled();

    await act(async () => {
      answerNext({ version: "2", name: "Anne" });
    });
    await waitFor(() => expect(result.current.draft.draft).toBe("Anne"));
    expect(result.current.draft.token).toBe("2");
    expect(result.current.draft.touched).toBe(false);
  });

  it("shows a failed opening read over a cached draft as its load error", async () => {
    const offline = new Error("offline");
    const fetcher = answering({ version: "1", name: "Anna" }, offline, {
      version: "2",
      name: "Anne",
    });
    const list = renderHook(() =>
      useSWRAuth("draft-open-failed", fetcher, { shouldRetryOnError: false }),
    );
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const { result } = renderHook(() =>
      useNameDraft("draft-open-failed", fetcher),
    );
    await waitFor(() => expect(result.current.status).toBe("loadFailed"));
    // The cached draft is on screen, the failure is not hidden behind it.
    expect(result.current.base).toEqual({ version: "1", name: "Anna" });
    expect(result.current.error).toBe(offline);

    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.error).toBeUndefined();
    expect(result.current.draft).toBe("Anne");
    expect(result.current.token).toBe("2");
  });

  it("reports a failed read after a save and sends nothing until a read succeeds", async () => {
    const offline = new Error("offline");
    const fetcher = answering({ version: "1", name: "Anna" }, offline, {
      version: "2",
      name: "Hanna",
    });
    const { result } = renderHook(() => useNameDraft("draft-saved", fetcher));
    await waitFor(() => expect(result.current.draft).toBe("Anna"));
    act(() => result.current.setDraft("Hanna"));
    let outcome!: ReadDraftResult<Stored>;
    await act(async () => {
      outcome = await result.current.submit(async () => ({
        version: "2",
        name: "Hanna",
      }));
    });
    expect(outcome.ok).toBe(true);
    expect(result.current.status).toBe("loadFailed");
    expect(result.current.error).toBe(offline);
    expect(result.current.canSubmit).toBe(false);

    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.token).toBe("2"));
    expect(result.current.canSubmit).toBe(true);
  });

  it("keeps the input a rebase kept when the retry of a failed reload succeeds", async () => {
    const offline = new Error("offline");
    const fetcher = answering({ version: "1", name: "Anna" }, offline, {
      version: "2",
      name: "Anne",
    });
    const { result } = renderHook(() =>
      useNameDraft("draft-retry-rebase", fetcher, { rebase: (draft) => draft }),
    );
    await waitFor(() => expect(result.current.draft).toBe("Anna"));
    act(() => result.current.setDraft("Hanna"));
    await act(async () => {
      const outcome = await result.current.submit(() =>
        Promise.reject(changed()),
      );
      if (!outcome.ok) await outcome.reload?.()?.catch(() => undefined);
    });
    expect(result.current.status).toBe("loadFailed");

    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.token).toBe("2"));
    expect(result.current.draft).toBe("Hanna");
    expect(result.current.touched).toBe(true);
  });

  it("keeps input typed while the read after a refusal failed", async () => {
    const offline = new Error("offline");
    const fetcher = answering({ version: "1", name: "Anna" }, offline, {
      version: "2",
      name: "Anne",
    });
    const { result } = renderHook(() =>
      useNameDraft("draft-typed-after-refusal", fetcher, {
        rebase: (draft) => draft,
      }),
    );
    await waitFor(() => expect(result.current.draft).toBe("Anna"));
    act(() => result.current.setDraft("Hanna"));
    await act(async () => {
      const outcome = await result.current.submit(() =>
        Promise.reject(changed()),
      );
      if (!outcome.ok) await outcome.reload?.()?.catch(() => undefined);
    });
    expect(result.current.status).toBe("loadFailed");

    // Typed after the refusal, before the stored state could be read.
    act(() => result.current.setDraft("Johanna"));
    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.token).toBe("2"));
    expect(result.current.draft).toBe("Johanna");
  });

  it("holds the preview shown at the opening when follow is false", async () => {
    let answerOwn!: (stored: Stored) => void;
    const fetcher = vi
      .fn<() => Promise<Stored>>()
      .mockResolvedValueOnce({ version: "1", name: "Anna" })
      .mockImplementationOnce(
        () =>
          new Promise<Stored>((resolve) => {
            answerOwn = resolve;
          }),
      );
    // An earlier view left the preview in the cache.
    const list = renderHook(() =>
      useSWRAuth("draft-preview", fetcher, { shouldRetryOnError: false }),
    );
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    list.unmount();
    const { result } = renderHook(() =>
      useReadDraft<Stored, Stored, string, unknown>({
        key: "draft-preview",
        fetcher,
        token: (read) => read.version,
        follow: false,
      }),
    );
    await waitFor(() => expect(result.current.token).toBe("1"));
    await act(async () => {
      answerOwn({ version: "2", name: "Anne" });
    });
    await waitFor(() => expect(result.current.newer).toBe(true));
    // The confirm sends the token of the preview on screen.
    expect(result.current.base).toEqual({ version: "1", name: "Anna" });
    const send = vi.fn(async () => undefined);
    await act(async () => {
      await result.current.submit(send);
    });
    expect(send).toHaveBeenCalledWith("1", { version: "1", name: "Anna" });
  });

  it("keeps a failed reload after a refusal when follow turns off over an older held read", async () => {
    const offline = new Error("offline");
    const fetcher = answering({ version: "1", name: "Anna" }, offline);
    const { result, rerender } = renderHook(
      ({ follow }: { follow: boolean }) => ({
        draft: useReadDraft<Stored, string, string, unknown>({
          key: "draft-follow-off",
          fetcher,
          token: (read) => read.version,
          toDraft: (read) => read.name,
          follow,
        }),
        cache: useSWRAuth<Stored>("draft-follow-off", fetcher, {
          revalidateOnMount: false,
          revalidateIfStale: false,
          shouldRetryOnError: false,
        }),
      }),
      { initialProps: { follow: true } },
    );
    await waitFor(() => expect(result.current.draft.token).toBe("1"));
    // A background read of the plan brings a newer state; the opening's own
    // read (version 1) stays held.
    await act(async () => {
      await result.current.cache.mutate(
        { version: "2", name: "Anne" },
        { revalidate: false },
      );
    });
    await waitFor(() => expect(result.current.draft.token).toBe("2"));
    await act(async () => {
      const outcome = await result.current.draft.submit(() =>
        Promise.reject(changed()),
      );
      if (!outcome.ok) await outcome.reload?.()?.catch(() => undefined);
    });
    expect(result.current.draft.status).toBe("loadFailed");

    // Leaving the editor: the draft holds instead of following.
    rerender({ follow: false });
    expect(result.current.draft.status).toBe("loadFailed");
    expect(result.current.draft.error).toBe(offline);
    expect(result.current.draft.canSubmit).toBe(false);
    expect(result.current.draft.token).toBe("2");
  });

  it("waits for a newer row of a list the caller reloads (useDraftOn)", async () => {
    const reload = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(
      ({ row }: { row: Stored }) =>
        useDraftOn<Stored, string, string, unknown>(
          { opening: "row-1", data: row, reload },
          { token: (read) => read.version, toDraft: (read) => read.name },
        ),
      { initialProps: { row: { version: "1", name: "Anna" } } },
    );
    act(() => result.current.setDraft("Hanna"));
    await act(async () => {
      const outcome = await result.current.submit(() =>
        Promise.reject(changed()),
      );
      if (!outcome.ok) await outcome.reload?.();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.current.canSubmit).toBe(false);

    rerender({ row: { version: "2", name: "Anne" } });
    expect(result.current.draft).toBe("Anne");
    expect(result.current.token).toBe("2");
    expect(result.current.canSubmit).toBe(true);
  });
  it("keeps the input on the state an own write answered (adopt)", async () => {
    const { result } = renderHook(() =>
      useDraftOn<Stored, string, string, unknown>(
        {
          opening: "row-2",
          data: { version: "1", name: "Anna" },
          reload: async () => undefined,
        },
        { token: (read) => read.version, toDraft: (read) => read.name },
      ),
    );
    act(() => result.current.setDraft("Hanna"));
    // An attachment changed the stored state, not the name.
    act(() => result.current.adopt({ version: "2", name: "Anna" }));
    expect(result.current.draft).toBe("Hanna");
    expect(result.current.touched).toBe(true);
    expect(result.current.token).toBe("2");

    const send = vi.fn(async () => undefined);
    await act(async () => {
      await result.current.submit(send);
    });
    expect(send).toHaveBeenCalledWith("2", "Hanna");
  });

  it("adopts nothing while a refusal waits for the stored state (adopt)", async () => {
    const { result } = renderHook(() =>
      useDraftOn<Stored, string, string, unknown>(
        {
          opening: "row-3",
          data: { version: "1", name: "Anna" },
          reload: () => new Promise<undefined>(() => undefined),
        },
        { token: (read) => read.version, toDraft: (read) => read.name },
      ),
    );
    act(() => result.current.setDraft("Hanna"));
    await act(async () => {
      await result.current.submit(() => Promise.reject(changed()));
    });
    act(() => result.current.adopt({ version: "2", name: "Anna" }));
    expect(result.current.token).toBe("1");
    expect(result.current.canSubmit).toBe(false);
  });

  it("shows the stored state after an own write was refused (refuse)", async () => {
    // The read again also moves the list the draft rests on.
    let row: Stored = { version: "1", name: "Anna" };
    const reload = vi.fn(async () => {
      row = { version: "3", name: "Anne" };
      return row;
    });
    const { result } = renderHook(() =>
      useDraftOn<Stored, string, string, unknown>(
        { opening: "row-4", data: row, reload },
        { token: (read) => read.version, toDraft: (read) => read.name },
      ),
    );
    act(() => result.current.setDraft("Hanna"));
    // An attachment removal on version 1 was refused: the input goes, the
    // stored state comes, as after a refused save.
    await act(async () => {
      await result.current.refuse()();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.current.draft).toBe("Anne");
    expect(result.current.token).toBe("3");
    expect(result.current.touched).toBe(false);
    expect(result.current.canSubmit).toBe(true);
  });

  it("leaves a failed reload of the list only through a newer row (useDraftOn)", async () => {
    const offline = new Error("offline");
    const reload = vi.fn(async () => {
      throw offline;
    });
    const { result, rerender } = renderHook(
      ({ row }: { row: Stored }) =>
        useDraftOn<Stored, string, string, unknown>(
          { opening: "row-2", data: row, reload },
          { token: (read) => read.version, toDraft: (read) => read.name },
        ),
      { initialProps: { row: { version: "1", name: "Anna" } } },
    );
    act(() => result.current.setDraft("Hanna"));
    await act(async () => {
      const outcome = await result.current.submit(() =>
        Promise.reject(changed()),
      );
      if (!outcome.ok) await outcome.reload?.()?.catch(() => undefined);
    });
    expect(result.current.status).toBe("loadFailed");
    expect(result.current.error).toBe(offline);

    // Dropping the input does not make the refused version sendable.
    act(() => result.current.discard());
    expect(result.current.draft).toBe("Anna");
    expect(result.current.canSubmit).toBe(false);
    rerender({ row: { version: "1", name: "Anna" } });
    expect(result.current.canSubmit).toBe(false);

    // A later successful reload of the list brings the stored row.
    rerender({ row: { version: "2", name: "Anne" } });
    expect(result.current.status).toBe("ready");
    expect(result.current.draft).toBe("Anne");
    expect(result.current.token).toBe("2");
    expect(result.current.error).toBeUndefined();
  });

  it("keeps a row read before a refusal from ending the failed reload (useDraftOn)", async () => {
    const offline = new Error("offline");
    const reload = vi.fn(async () => {
      throw offline;
    });
    const { result, rerender } = renderHook(
      ({ row }: { row: Stored }) =>
        useDraftOn<Stored, string, string, unknown>(
          { opening: "row-3", data: row, reload },
          { token: (read) => read.version, toDraft: (read) => read.name },
        ),
      { initialProps: { row: { version: "1", name: "Anna" } } },
    );
    act(() => result.current.setDraft("Hanna"));
    // A newer row arrives under the touched draft, before the save.
    rerender({ row: { version: "2", name: "Anne" } });
    expect(result.current.newer).toBe(true);
    await act(async () => {
      const outcome = await result.current.submit(() =>
        Promise.reject(changed()),
      );
      if (!outcome.ok) await outcome.reload?.()?.catch(() => undefined);
    });
    // The state and the shown load error agree: nothing was read since.
    expect(result.current.status).toBe("loadFailed");
    expect(result.current.error).toBe(offline);
    expect(result.current.canSubmit).toBe(false);

    rerender({ row: { version: "3", name: "Annika" } });
    expect(result.current.status).toBe("ready");
    expect(result.current.draft).toBe("Annika");
    expect(result.current.error).toBeUndefined();
  });

  it("rests on the saved draft when the read after a save fails (useDraftOn)", async () => {
    const offline = new Error("offline");
    const reload = vi.fn(async () => {
      throw offline;
    });
    const { result, rerender } = renderHook(
      ({ row }: { row: Stored }) =>
        useDraftOn<Stored, string, string, unknown>(
          { opening: "row-4", data: row, reload },
          { token: (read) => read.version, toDraft: (read) => read.name },
        ),
      { initialProps: { row: { version: "1", name: "Anna" } } },
    );
    act(() => result.current.setDraft("Hanna"));
    // Another write's row, read before this save went out.
    rerender({ row: { version: "2", name: "Anne" } });
    let outcome!: ReadDraftResult<unknown>;
    await act(async () => {
      outcome = await result.current.submit(async () => undefined);
    });
    expect(outcome.ok).toBe(true);
    // The row read before the save does not replace what was saved.
    expect(result.current.status).toBe("loadFailed");
    expect(result.current.draft).toBe("Hanna");
    expect(result.current.touched).toBe(false);

    // Cancelling an edit returns to the saved state, not the one it replaced.
    act(() => result.current.setDraft("Hannah"));
    expect(result.current.touched).toBe(true);
    act(() => result.current.discard());
    expect(result.current.draft).toBe("Hanna");
    expect(result.current.touched).toBe(false);
    expect(result.current.canSubmit).toBe(false);

    rerender({ row: { version: "3", name: "Hanna" } });
    expect(result.current.status).toBe("ready");
    expect(result.current.token).toBe("3");
  });

  // Input typed after a save whose read failed rests on the saved draft:
  // a read that brings exactly that draft keeps it; any other stored state
  // replaces it.
  it("keeps input typed after a save when the read brings what was saved", async () => {
    const reload = vi.fn(async () => {
      throw new Error("offline");
    });
    const { result, rerender } = renderHook(
      ({ row }: { row: Stored }) =>
        useDraftOn<Stored, string, string, unknown>(
          { opening: "row-5", data: row, reload },
          { token: (read) => read.version, toDraft: (read) => read.name },
        ),
      { initialProps: { row: { version: "1", name: "Anna" } } },
    );
    act(() => result.current.setDraft("Hanna"));
    await act(async () => {
      await result.current.submit(async () => undefined);
    });
    expect(result.current.status).toBe("loadFailed");
    act(() => result.current.setDraft("Hannah"));

    rerender({ row: { version: "2", name: "Hanna" } });
    expect(result.current.status).toBe("ready");
    expect(result.current.token).toBe("2");
    expect(result.current.draft).toBe("Hannah");
    expect(result.current.touched).toBe(true);

    // A colleague's state instead of the saved one replaces the input.
    act(() => result.current.setDraft("Hanna B."));
    await act(async () => {
      await result.current.submit(async () => undefined);
    });
    act(() => result.current.setDraft("Hanna C."));
    rerender({ row: { version: "3", name: "Anne" } });
    expect(result.current.draft).toBe("Anne");
    expect(result.current.touched).toBe(false);
  });
});

describe("useActionOn", () => {
  interface Props {
    readonly data: Stored | undefined;
    readonly opening?: string | null;
  }
  function renderAction(reload: () => Promise<unknown>, data: Stored) {
    return renderHook(
      ({ data: shown, opening = "record-1" }: Props) =>
        useActionOn(
          { opening, data: shown, reload },
          { token: (read) => read.version },
        ),
      { initialProps: { data } as Props },
    );
  }
  const stored = { version: "1", name: "Anna" };

  async function refuse(result: { current: ReturnType<typeof useActionOn> }) {
    let sent!: ReadDraftResult<unknown>;
    await act(async () => {
      sent = await result.current.submit(() => Promise.reject(changed()));
    });
    expect(sent).toMatchObject({ ok: false, refused: true });
    return sent;
  }

  it("keeps a failed read after a refusal locked and shown until a read of another state arrives", async () => {
    const reload = vi.fn(() => Promise.reject(new ApiError("down", 503)));
    const { result, rerender } = renderAction(reload, stored);
    expect(result.current.canSubmit).toBe(true);

    await refuse(result);
    await waitFor(() => expect(result.current.status).toBe("loadFailed"));
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.error).toBeInstanceOf(ApiError);

    // The same state again (a revalidation of the refused version): still
    // locked, the failed read still shown.
    rerender({ data: { ...stored } });
    expect(result.current.status).toBe("loadFailed");

    // Another view's read brings the stored state: sending goes on from it,
    // whatever became of the message that offered „Wiederholen“.
    rerender({ data: { version: "2", name: "Anne" } });
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeUndefined();
  });

  it("lifts the lock when the read after a refusal succeeds, also on the same token", async () => {
    let answer!: () => void;
    const reload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    const { result } = renderAction(reload, stored);

    const sent = await refuse(result);
    expect(result.current.status).toBe("reloading");
    expect(result.current.canSubmit).toBe(false);
    // The error path asks for this read; it is the one already on its way.
    if (sent.ok) throw new Error("refused");
    const shown = sent.reload?.();
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer();
      await shown;
    });
    expect(result.current.status).toBe("ready");
  });

  it("retries a failed read and sends nothing twice while a send is out", async () => {
    const reload = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError("down", 503))
      .mockResolvedValueOnce(undefined);
    const { result } = renderAction(reload, stored);

    await refuse(result);
    await waitFor(() => expect(result.current.status).toBe("loadFailed"));
    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const send = vi.fn(() => new Promise<never>(() => undefined));
    let second!: ReadDraftResult<unknown>;
    await act(async () => {
      void result.current.submit(send);
      second = await result.current.submit(send);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ ok: false, skipped: true });
    expect(result.current.status).toBe("saving");
  });

  it("starts a new opening unlocked", async () => {
    const reload = vi.fn(() => Promise.reject(new ApiError("down", 503)));
    const { result, rerender } = renderAction(reload, stored);
    await refuse(result);
    await waitFor(() => expect(result.current.status).toBe("loadFailed"));

    rerender({ data: stored, opening: null });
    rerender({ data: stored, opening: "record-1" });
    expect(result.current.status).toBe("ready");
  });
});
