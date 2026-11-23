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
import { useSWRAuth } from "./hooks";
import { useDraftOn, useReadDraft, type ReadDraftResult } from "./read-draft";
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
});
